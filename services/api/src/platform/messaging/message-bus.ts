const crypto = require("node:crypto");
const DEFAULT_RETENTION_MAX_ENTRIES = 1024;

export interface MessageEnvelope<T = unknown> {
  event_id: string;
  event_type: string;
  event_version: number;
  aggregate_id: string;
  request_id: string;
  occurred_at: string;
  payload: T;
}

export interface DeadLetterRecord {
  event_id: string;
  event_type: string;
  consumer_id: string;
  attempts: number;
  reason_code: "handler_failed";
}

export interface SubscriptionOptions {
  consumerId?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export type MessageHandler<T = unknown> = (message: MessageEnvelope<T>) => Promise<void> | void;

export interface MessageBus {
  publish<T>(message: MessageEnvelope<T>): Promise<PublishResult>;
  subscribe<T>(eventType: string, handler: MessageHandler<T>, options?: SubscriptionOptions): () => void;
  getDeadLetters(): DeadLetterRecord[];
  healthCheck(): Promise<DependencyHealth>;
}

export interface DependencyHealth {
  dependency: string;
  status: "up" | "degraded" | "down";
  latency_ms: number;
  reason_code: string;
}

interface Subscription<T = unknown> {
  consumerId: string;
  handler: MessageHandler<T>;
  maxAttempts: number;
  retryDelayMs: number;
}

export interface PublishResult {
  delivered: number;
  duplicates: number;
  dead_lettered: number;
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function validateMessage(message) {
  if (!message || typeof message !== "object") throw new TypeError("message must be an object");
  for (const field of ["event_id", "event_type", "aggregate_id", "request_id", "occurred_at"]) {
    if (typeof message[field] !== "string" || !message[field].trim()) throw new TypeError(`${field} is required`);
  }
  if (!Number.isInteger(message.event_version) || message.event_version < 1) throw new TypeError("event_version must be a positive integer");
  if (!Object.hasOwn(message, "payload")) throw new TypeError("payload is required");
}

function payloadFingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload) ?? "undefined", "utf8").digest("hex");
}

function retainSetEntry(collection: Set<string>, value: string, maximum: number): void {
  collection.add(value);
  while (collection.size > maximum) {
    const oldest = collection.values().next().value;
    if (oldest === undefined) break;
    collection.delete(oldest);
  }
}

function retainDeadLetter(records: DeadLetterRecord[], record: DeadLetterRecord, maximum: number): void {
  records.push(record);
  if (records.length > maximum) records.splice(0, records.length - maximum);
}

/**
 * This adapter bounds ephemeral state for deterministic tests. Production adapters must use durable TTL-backed stores for idempotency and dead letters.
 */
class InMemoryMessageBus implements MessageBus {
  private readonly subscriptions = new Map<string, Array<Subscription>>();
  private readonly completed = new Set<string>();
  private readonly deadLettered = new Set<string>();
  private readonly inFlight = new Map<string, Promise<PublishResult>>();
  private readonly deadLetters: DeadLetterRecord[] = [];
  private readonly defaultMaxAttempts: number;
  private readonly defaultRetryDelayMs: number;
  private readonly retentionMaxEntries: number;
  private nextConsumerNumber = 1;

  constructor(options: { defaultMaxAttempts?: number; retryDelayMs?: number; retentionMaxEntries?: number } = {}) {
    this.defaultMaxAttempts = boundedInteger(options.defaultMaxAttempts ?? 3, 1, 5, "defaultMaxAttempts");
    this.defaultRetryDelayMs = boundedInteger(options.retryDelayMs ?? 0, 0, 60000, "retryDelayMs");
    this.retentionMaxEntries = boundedInteger(options.retentionMaxEntries ?? DEFAULT_RETENTION_MAX_ENTRIES, 1, 100000, "retentionMaxEntries");
  }

  subscribe<T>(
    eventType: string,
    handler: MessageHandler<T>,
    options: SubscriptionOptions = {},
  ): () => void {
    if (typeof eventType !== "string" || !eventType.trim()) throw new TypeError("eventType is required");
    if (typeof handler !== "function") throw new TypeError("handler is required");
    const consumerId = options.consumerId ?? `consumer-${this.nextConsumerNumber++}`;
    if (typeof consumerId !== "string" || !consumerId.trim()) throw new TypeError("consumerId is required");
    const subscriptions = this.subscriptions.get(eventType) ?? [];
    if (subscriptions.some((candidate) => candidate.consumerId === consumerId)) {
      throw new Error("consumerId is already registered for this event type");
    }
    const subscription: Subscription<T> = {
      consumerId,
      handler,
      maxAttempts: boundedInteger(options.maxAttempts ?? this.defaultMaxAttempts, 1, 5, "maxAttempts"),
      retryDelayMs: boundedInteger(options.retryDelayMs ?? this.defaultRetryDelayMs, 0, 60000, "retryDelayMs"),
    };
    subscriptions.push(subscription);
    this.subscriptions.set(eventType, subscriptions);
    return () => {
      const current = this.subscriptions.get(eventType) ?? [];
      this.subscriptions.set(eventType, current.filter((candidate) => candidate !== subscription));
    };
  }

  async publish<T>(message: MessageEnvelope<T>): Promise<PublishResult> {
    validateMessage(message);
    const subscriptions = [...(this.subscriptions.get(message.event_type) ?? [])];
    const result: PublishResult = { delivered: 0, duplicates: 0, dead_lettered: 0 };
    for (const subscription of subscriptions) {
      const delivery = await this.deliver(message, subscription);
      result.delivered += delivery.delivered;
      result.duplicates += delivery.duplicates;
      result.dead_lettered += delivery.dead_lettered;
    }
    return result;
  }

  private async deliver<T>(message: MessageEnvelope<T>, subscription: Subscription<T>): Promise<PublishResult> {
    const deliveryKey = `${subscription.consumerId}:${message.event_id}`;
    if (this.completed.has(deliveryKey) || this.deadLettered.has(deliveryKey)) {
      return { delivered: 0, duplicates: 1, dead_lettered: 0 };
    }
    const inFlightDelivery = this.inFlight.get(deliveryKey);
    if (inFlightDelivery) {
      await inFlightDelivery;
      return { delivered: 0, duplicates: 1, dead_lettered: 0 };
    }

    const deliveryPromise = this.processDelivery(message, subscription, deliveryKey);
    this.inFlight.set(deliveryKey, deliveryPromise);
    try {
      return await deliveryPromise;
    } finally {
      this.inFlight.delete(deliveryKey);
    }
  }

  private async processDelivery<T>(
    message: MessageEnvelope<T>,
    subscription: Subscription<T>,
    deliveryKey: string,
  ): Promise<PublishResult> {
    for (let attempt = 1; attempt <= subscription.maxAttempts; attempt += 1) {
      try {
        await subscription.handler(message);
        retainSetEntry(this.completed, deliveryKey, this.retentionMaxEntries);
        return { delivered: 1, duplicates: 0, dead_lettered: 0 };
      } catch {
        if (attempt === subscription.maxAttempts) {
          retainSetEntry(this.deadLettered, deliveryKey, this.retentionMaxEntries);
          retainDeadLetter(this.deadLetters, {
            event_id: message.event_id,
            event_type: message.event_type,
            consumer_id: subscription.consumerId,
            attempts: attempt,
            reason_code: "handler_failed",
          }, this.retentionMaxEntries);
          return { delivered: 0, duplicates: 0, dead_lettered: 1 };
        }
        if (subscription.retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, subscription.retryDelayMs));
        }
      }
    }
    return { delivered: 0, duplicates: 0, dead_lettered: 0 };
  }

  getDeadLetters(): DeadLetterRecord[] {
    return this.deadLetters.map((deadLetter) => ({ ...deadLetter }));
  }

  getRetentionStats() {
    return {
      completed: this.completed.size,
      dead_lettered: this.deadLettered.size,
      dead_letters: this.deadLetters.length,
    };
  }

  async healthCheck() {
    return { dependency: "queue", status: "up", latency_ms: 0, reason_code: "ok" };
  }

  getMessageFingerprint<T>(message: MessageEnvelope<T>): string {
    validateMessage(message);
    return `sha256:${payloadFingerprint(message.payload)}`;
  }
}

module.exports = {
  InMemoryMessageBus,
};
