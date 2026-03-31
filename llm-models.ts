/**
 * BytePlus ModelArk — LLM model catalog and provider constants.
 *
 * Merged from encircleacity2/claw-plugin-byteplus-modelark with additions:
 * - REASONING_MODEL_IDS set for Seed deep-thinking models
 * - compat fields (supportsReasoningEffort, supportsUsageInStreaming)
 */

// ─── Base URLs ────────────────────────────────────────────────────────────────

export const BYTEPLUS_LLM_BASE_URL =
  "https://ark.ap-southeast.bytepluses.com/api/v3";

export const BYTEPLUS_LLM_CODING_BASE_URL =
  "https://ark.ap-southeast.bytepluses.com/api/coding/v3";

// ─── Default model refs ───────────────────────────────────────────────────────

export const BYTEPLUS_LLM_DEFAULT_MODEL_ID = "seed-2-0-pro-260328";
export const BYTEPLUS_LLM_CODING_DEFAULT_MODEL_ID = "ark-code-latest";
export const BYTEPLUS_LLM_DEFAULT_MODEL_REF = `byteplus-modelark/${BYTEPLUS_LLM_DEFAULT_MODEL_ID}`;
export const BYTEPLUS_LLM_CODING_DEFAULT_MODEL_REF = `byteplus-modelark-plan/${BYTEPLUS_LLM_CODING_DEFAULT_MODEL_ID}`;

// ─── Pricing ──────────────────────────────────────────────────────────────────

export const BYTEPLUS_LLM_DEFAULT_COST = {
  input: 0.0001,
  output: 0.0002,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

// ─── Model catalogs ───────────────────────────────────────────────────────────

export const BYTEPLUS_LLM_MODEL_CATALOG = [
  {
    id: "seed-2-0-pro-260328",
    name: "Seed 2.0 Pro",
    reasoning: true,
    input: ["text", "image"] as ["text", "image"],
    cost: BYTEPLUS_LLM_DEFAULT_COST,
    contextWindow: 256_000,
    maxTokens: 8_192,
    compat: {
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
    },
  },
  {
    id: "seed-2-0-lite-260228",
    name: "Seed 2.0 Lite",
    reasoning: true,
    input: ["text", "image"] as ["text", "image"],
    cost: BYTEPLUS_LLM_DEFAULT_COST,
    contextWindow: 256_000,
    maxTokens: 4_096,
    compat: {
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
    },
  },
  {
    id: "seed-1-8-251228",
    name: "Seed 1.8",
    reasoning: true,
    input: ["text", "image"] as ["text", "image"],
    cost: BYTEPLUS_LLM_DEFAULT_COST,
    contextWindow: 256_000,
    maxTokens: 4_096,
    compat: {
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
    },
  },
  {
    id: "kimi-k2-5",
    name: "Kimi K2.5",
    reasoning: true,
    input: ["text"] as ["text"],
    cost: BYTEPLUS_LLM_DEFAULT_COST,
    contextWindow: 131_072,
    maxTokens: 16_384,
    compat: {
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
    },
  },
  {
    id: "glm-4-7",
    name: "GLM 4.7",
    reasoning: false,
    input: ["text", "image"] as ["text", "image"],
    cost: BYTEPLUS_LLM_DEFAULT_COST,
    contextWindow: 128_000,
    maxTokens: 8_192,
  },
] as const;

export const BYTEPLUS_LLM_CODING_MODEL_CATALOG = [
  {
    id: "ark-code-latest",
    name: "Ark Code (Latest)",
    reasoning: false,
    input: ["text"] as ["text"],
    cost: BYTEPLUS_LLM_DEFAULT_COST,
    contextWindow: 256_000,
    maxTokens: 8_192,
  },
] as const;

/** Model IDs that support Seed deep thinking (thinking + reasoning_effort params). */
export const REASONING_MODEL_IDS = new Set<string>([
  "seed-2-0-pro-260328",
  "seed-2-0-lite-260228",
  "seed-1-8-251228",
  "kimi-k2-5",
]);
