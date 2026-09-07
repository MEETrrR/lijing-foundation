const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { COMPANION_PROMPTS, DEFAULT_COMPANION_ID, getCompanionPrompt } = require("./companion-prompts.ts");

const PROFILE_VERSION = 1;
const SAFE_TOPIC = 200;

function profileKey(actorId) {
  return `companion:profile:${actorId}`;
}

function initialProfile() {
  return {
    version: PROFILE_VERSION,
    companion_id: DEFAULT_COMPANION_ID,
    prompt_version: getCompanionPrompt(DEFAULT_COMPANION_ID).version,
    interaction_count: 0,
    first_seen_at: null,
    last_seen_at: null,
    last_request_id: null,
    last_topic: null,
    recent_topics: [],
    recent_request_ids: [],
  };
}

function normalizeTopic(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > SAFE_TOPIC) throw new PlatformError("VALIDATION_ERROR", "companion topic is invalid");
  return value.trim();
}

function validateInteraction(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlatformError("VALIDATION_ERROR", "companion interaction must be an object");
  const companionId = input.companion_id || DEFAULT_COMPANION_ID;
  if (!Object.hasOwn(COMPANION_PROMPTS, companionId)) throw new PlatformError("VALIDATION_ERROR", "companion_id is not supported");
  if (typeof input.request_id !== "string" || input.request_id.length < 16 || input.request_id.length > 120) throw new PlatformError("VALIDATION_ERROR", "companion request_id is invalid");
  const iterationCount = input.learning_iteration_count === undefined ? null : Number(input.learning_iteration_count);
  if (iterationCount !== null && (!Number.isInteger(iterationCount) || iterationCount < 0 || iterationCount > 100000)) throw new PlatformError("VALIDATION_ERROR", "learning_iteration_count is invalid");
  return {
    companion_id: companionId,
    prompt_version: getCompanionPrompt(companionId).version,
    request_id: input.request_id,
    topic: normalizeTopic(input.topic),
    learning_iteration_count: iterationCount,
    last_iteration_id: normalizeTopic(input.last_iteration_id),
  };
}

function publicProfile(profile) {
  return {
    version: profile.version,
    companion_id: profile.companion_id,
    prompt_version: profile.prompt_version,
    interaction_count: profile.interaction_count,
    first_seen_at: profile.first_seen_at,
    last_seen_at: profile.last_seen_at,
    last_request_id: profile.last_request_id,
    last_topic: profile.last_topic,
    recent_topics: [...profile.recent_topics],
  };
}

class CompanionService {
  constructor({ database, clock = () => Date.now() }) {
    this.database = database;
    this.clock = clock;
  }

  async getProfile(actorId, requestId = null) {
    const profile = await this.database.get(profileKey(actorId)) ?? initialProfile();
    return {
      request_id: requestId,
      ...publicProfile(profile),
    };
  }

  async recordInteraction(actorId, input) {
    const interaction = validateInteraction(input);
    return this.database.transaction(async (database) => {
      const current = await database.get(profileKey(actorId)) ?? initialProfile();
      if (current.recent_request_ids.includes(interaction.request_id)) return { profile: publicProfile(current), replayed: true };
      const now = new Date(this.clock()).toISOString();
      const next = {
        ...current,
        companion_id: interaction.companion_id,
        prompt_version: interaction.prompt_version,
        interaction_count: current.interaction_count + 1,
        first_seen_at: current.first_seen_at ?? now,
        last_seen_at: now,
        last_request_id: interaction.request_id,
        last_topic: interaction.topic,
        recent_topics: interaction.topic ? [interaction.topic, ...current.recent_topics.filter((topic) => topic !== interaction.topic)].slice(0, 8) : [...current.recent_topics],
        recent_request_ids: [interaction.request_id, ...current.recent_request_ids].slice(0, 100),
        last_iteration_id: interaction.last_iteration_id,
        learning_iteration_count: interaction.learning_iteration_count,
      };
      await database.set(profileKey(actorId), next);
      return { profile: publicProfile(next), replayed: false };
    });
  }
}

module.exports = {
  CompanionService,
  initialProfile,
  publicProfile,
  validateInteraction,
};
