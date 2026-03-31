import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-models";
import {
  BYTEPLUS_LLM_BASE_URL,
  BYTEPLUS_LLM_CODING_BASE_URL,
  BYTEPLUS_LLM_CODING_MODEL_CATALOG,
  BYTEPLUS_LLM_MODEL_CATALOG,
} from "./llm-models.js";

export function buildBytePlusLlmProvider(): ModelProviderConfig {
  return {
    baseUrl: BYTEPLUS_LLM_BASE_URL,
    api: "openai-completions",
    models: [...BYTEPLUS_LLM_MODEL_CATALOG],
  };
}

export function buildBytePlusLlmCodingProvider(): ModelProviderConfig {
  return {
    baseUrl: BYTEPLUS_LLM_CODING_BASE_URL,
    api: "openai-completions",
    models: [...BYTEPLUS_LLM_CODING_MODEL_CATALOG],
  };
}
