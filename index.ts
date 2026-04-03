import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth";
import { ensureModelAllowlistEntry } from "openclaw/plugin-sdk/provider-onboard";
import { buildBytePlusLlmCodingProvider, buildBytePlusLlmProvider } from "./llm-provider.js";
import {
  BYTEPLUS_LLM_DEFAULT_MODEL_REF,
  REASONING_MODEL_IDS,
} from "./llm-models.js";
import { createSeedanceTool } from "./seedance-tool.js";
import { createSeedreamTool } from "./seedream-tool.js";

const PLUGIN_ID = "@xieyongliang/byteplus-modelark";
const PROVIDER_ID = "byteplus-modelark";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "BytePlus ModelArk",
  description:
    "BytePlus ARK API: Seed/Kimi/GLM language models, Seedream image generation, and Seedance video generation",
  register(api) {
    // ── LLM Provider ──────────────────────────────────────────────────────────
    api.registerProvider({
      id: PROVIDER_ID,
      label: "BytePlus ModelArk",
      docsPath: "/concepts/model-providers#byteplus-international",
      envVars: ["BYTEPLUS_API_KEY"],

      auth: [
        createProviderApiKeyAuthMethod({
          providerId: PROVIDER_ID,
          methodId: "api-key",
          label: "BytePlus ModelArk API key",
          hint: "API key from your BytePlus ModelArk console",
          optionKey: "byteplusModelarkApiKey",
          flagName: "--byteplus-modelark-api-key",
          envVar: "BYTEPLUS_API_KEY",
          promptMessage: "Enter your BytePlus ModelArk API key",
          defaultModel: BYTEPLUS_LLM_DEFAULT_MODEL_REF,
          expectedProviders: [PROVIDER_ID],
          applyConfig: (cfg) =>
            ensureModelAllowlistEntry({
              cfg,
              modelRef: BYTEPLUS_LLM_DEFAULT_MODEL_REF,
            }),
          wizard: {
            choiceId: "byteplus-modelark-api-key",
            choiceLabel: "BytePlus ModelArk API key",
            groupId: PROVIDER_ID,
            groupLabel: "BytePlus ModelArk",
            groupHint: "API key",
          },
        }),
      ],

      // Inject Seed-specific params (thinking, reasoning_effort, service_tier)
      // for models that support deep thinking. Non-Seed models pass through unchanged.
      prepareExtraParams: (ctx) => {
        const params: Record<string, unknown> = { ...ctx.extraParams };

        if (!REASONING_MODEL_IDS.has(ctx.modelId)) {
          return params;
        }

        if (!params.service_tier) {
          params.service_tier = "auto";
        }

        if (ctx.thinkingLevel == null || ctx.thinkingLevel === "off") {
          if (!params.thinking) params.thinking = { type: "disabled" };
          if (!params.reasoning_effort) params.reasoning_effort = "minimal";
        } else {
          const effortMap: Record<string, string> = {
            low: "low",
            medium: "medium",
            high: "high",
          };
          if (!params.thinking) params.thinking = { type: "enabled" };
          if (!params.reasoning_effort) {
            params.reasoning_effort = effortMap[ctx.thinkingLevel] ?? "medium";
          }
          // Avoid sending both max_tokens and max_completion_tokens together.
          if (params.max_completion_tokens) {
            delete params.max_tokens;
          }
        }

        return params;
      },

      catalog: {
        // "paired" registers byteplus-modelark and byteplus-modelark-plan
        // together from a single API key resolution.
        order: "paired",
        run: async (ctx) => {
          const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }
          return {
            providers: {
              [PROVIDER_ID]: { ...buildBytePlusLlmProvider(), apiKey },
              [`${PROVIDER_ID}-plan`]: { ...buildBytePlusLlmCodingProvider(), apiKey },
            },
          };
        },
      },
    });

    // ── Image & Video Tools ───────────────────────────────────────────────────
    api.registerTool(createSeedreamTool(api) as AnyAgentTool);
    api.registerTool(createSeedanceTool(api) as AnyAgentTool);
  },
});
