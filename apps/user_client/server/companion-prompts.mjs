import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const shared = require("../../../services/api/src/domains/companion/companion-prompts.ts");

export const COMPANION_PROMPTS = shared.COMPANION_PROMPTS;
export const DEFAULT_COMPANION_ID = shared.DEFAULT_COMPANION_ID;
export const getCompanionPrompt = shared.getCompanionPrompt;
