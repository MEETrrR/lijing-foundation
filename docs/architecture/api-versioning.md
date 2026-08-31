# API Versioning

## Base path

The public HTTP contract uses `/api/v1`. The version is part of the URL so mobile clients can remain stable while the server evolves. The OpenAPI baseline is in `packages/contracts/openapi.yaml`.

`v1` is a major contract line. Additive, backward-compatible fields may be introduced within `v1` when they are optional for existing clients. A change that alters meaning, removes a field, changes authorization semantics, changes an enum incompatibly, or changes a write result requires a new major path such as `/api/v2` or an explicitly approved migration contract.

Do not expose database table names, column names, SQL fragments, ORM models, queue topics, provider model identifiers, or internal ledger layout as the public API. Endpoints represent use cases and stable domain resources.

## Request context

Every request has a `request_id` for tracing, audit correlation, support investigation, and event linkage. Clients should send a UUID-shaped request ID; the server rejects malformed IDs and generates one for safe read-only requests when a compatibility edge requires it. The response returns the accepted request ID and a trace ID where applicable.

Every state-changing operation requires both:

1. `request_id` in the write request metadata/body, bound to the authenticated actor and server request context.
2. `Idempotency-Key` as a separate header, scoped to actor, route, and operation family.

The same idempotency key with the same normalized payload returns the original result. Reusing it with a different payload, actor, or route returns a conflict. The server stores the key outcome long enough to cover the retry window and records the decision in the audit trail.

The client does not submit a final result. For example, an answer request can contain a question ID and selected answer, but not `correct`, `mastery`, `reward`, `energy`, `balance`, or `completed`. The server evaluates and settles those values.

## Write contract

All writes must define:

- authentication and authorization requirements;
- request ID and idempotency requirements;
- input limits and validation errors;
- a stable operation ID and domain-level error codes;
- retry semantics and whether the operation is safe to replay;
- the server-owned result and the event emitted after commit;
- audit fields, quota consumption, rollback, and kill-switch behavior.

The response envelope includes a safe `request_id`, a stable `code`, a user-facing `message`, and a `retryable` flag. Internal stack traces, SQL, provider errors, tokens, and sensitive input are not returned.

## Read contract

Read endpoints may use projections and caches, but caches are never the only source of truth. A read response must identify its representation version where a stale projection could affect user decisions. A deleted, revoked, or unauthorized resource is not revealed through distinguishable error detail.

## Deprecation and rollout

Breaking changes follow this sequence:

1. Add the new version or an optional replacement field.
2. Publish migration notes and client minimum-version requirements.
3. Measure traffic by client version and actor cohort.
4. Announce a concrete sunset date and return a stable deprecation signal.
5. Disable only after the owning team confirms no supported client depends on the old contract.

Prompt versions, AI policy versions, content versions, and event schema versions are independent of the HTTP major version and must be recorded in their own fields.

## Security boundary

Clients never call model providers, databases, queues, or private object storage directly. AI actions go through the server AI Gateway, which performs authentication, feature permission, account/device/IP limits, token budgets, input and attachment limits, idempotency, output validation, usage settlement, audit, and kill-switch checks.
