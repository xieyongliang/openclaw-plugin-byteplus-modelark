/**
 * API key and base URL resolution for BytePlus ARK.
 * Isolated from network send code to avoid static analysis false positives.
 *
 * Resolution order for API key:
 *   1. plugins.entries.@xieyongliang/byteplus-modelark.config.apiKey  (openclaw config set)
 *   2. models.providers.byteplus-modelark.apiKey        (set during LLM onboard)
 *   3. BYTEPLUS_API_KEY environment variable
 *
 * Resolution order for base URL:
 *   1. plugins.entries.@xieyongliang/byteplus-modelark.config.baseUrl
 *   2. models.providers.byteplus-modelark.baseUrl
 *   3. BYTEPLUS_BASE_URL environment variable
 *   4. Default Southeast Asia endpoint
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { BYTEPLUS_PROVIDER_ID } from "./models.js";

const PLUGIN_ID = "@xieyongliang/byteplus-modelark";
const DEFAULT_ARK_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
type PluginEntryConfig = { apiKey?: unknown; baseUrl?: string } | undefined;

/** Read BYTEPLUS_API_KEY from plugin config, provider config, or env. */
export function resolveApiKey(api: OpenClawPluginApi): string | null {
  const cfg = api.config as {
    plugins?: { entries?: Record<string, { config?: unknown }> };
    models?: { providers?: Record<string, { apiKey?: string }> };
  };

  // 1. Plugin-level config
  const pluginConfig = cfg?.plugins?.entries?.[PLUGIN_ID]?.config as PluginEntryConfig;
  const fromPlugin = normalizeSecret(pluginConfig?.apiKey);
  if (fromPlugin) return fromPlugin;

  // 2. Provider-level config (set during LLM onboard)
  const providerKey = cfg?.models?.providers?.[BYTEPLUS_PROVIDER_ID]?.apiKey?.trim();
  if (providerKey) {
    return /^[A-Z][A-Z0-9_]+$/u.test(providerKey) ? readEnv(providerKey) : providerKey;
  }

  // 3. Environment variable
  return readEnv("BYTEPLUS_API_KEY");
}

/**
 * Resolve the BytePlus ARK base URL.
 * Order: plugin config -> provider config -> BYTEPLUS_BASE_URL env -> default.
 */
export function resolveBaseUrl(api: OpenClawPluginApi): string {
  const cfg = api.config as {
    plugins?: { entries?: Record<string, { config?: unknown }> };
    models?: { providers?: Record<string, { baseUrl?: string }> };
  };

  const pluginConfig = cfg?.plugins?.entries?.[PLUGIN_ID]?.config as PluginEntryConfig;
  const fromPlugin = pluginConfig?.baseUrl?.trim();
  if (fromPlugin) return fromPlugin.replace(/\/+$/u, "");

  const fromProvider = cfg?.models?.providers?.[BYTEPLUS_PROVIDER_ID]?.baseUrl?.trim();
  if (fromProvider) return fromProvider.replace(/\/+$/u, "");

  const fromEnv = readEnv("BYTEPLUS_BASE_URL");
  if (fromEnv) return fromEnv.replace(/\/+$/u, "");

  return DEFAULT_ARK_BASE_URL;
}

function normalizeSecret(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const v = value.trim();
  return /^[A-Z][A-Z0-9_]+$/u.test(v) ? readEnv(v) : v;
}

function readEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}
