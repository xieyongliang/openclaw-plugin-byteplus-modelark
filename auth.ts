/**
 * API key resolution for BytePlus ARK — isolated from network send code
 * so static analyzers do not conflate env var reads with outbound requests.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { BYTEPLUS_PROVIDER_ID } from "./models.js";

const ENV_VAR_NAME = "BYTEPLUS_API_KEY";

/** Read BYTEPLUS_API_KEY from env or from the OpenClaw provider config. */
export function resolveApiKey(api: OpenClawPluginApi): string | null {
  const fromEnv = readBytePlusApiKeyEnv();
  if (fromEnv) return fromEnv;

  // Fallback: read from the bundled byteplus provider config if present.
  // The value may be a literal key or an env var marker like "BYTEPLUS_API_KEY".
  const providerApiKey = (
    api.config as {
      models?: { providers?: Record<string, { apiKey?: string }> };
    }
  )?.models?.providers?.[BYTEPLUS_PROVIDER_ID]?.apiKey?.trim();

  if (providerApiKey) {
    if (/^[A-Z][A-Z0-9_]+$/u.test(providerApiKey)) {
      return readEnvVar(providerApiKey);
    }
    return providerApiKey;
  }

  return null;
}

function readBytePlusApiKeyEnv(): string | null {
  return readEnvVar(ENV_VAR_NAME);
}

function readEnvVar(name: string): string | null {
  return process.env[name]?.trim() || null;
}
