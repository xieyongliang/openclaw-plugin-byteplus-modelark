import { Type } from "@sinclair/typebox";
import OpenAI from "openai";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { saveMediaBuffer } from "openclaw/plugin-sdk/media-runtime";
import { resolveApiKey } from "./auth.js";
import { SEEDREAM_DEFAULT_MODEL } from "./models.js";

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const DEFAULT_MIME = "image/png";
const IMAGE_MAX_BYTES = 32 * 1024 * 1024; // 32 MB — Seedream 4K images can be large

function optionalStringEnum<const T extends readonly string[]>(
  values: T,
  opts: { description?: string } = {},
) {
  return Type.Optional(
    Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...opts }),
  );
}

const SeedreamToolSchema = Type.Object(
  {
    prompt: Type.String({ description: "Text description of the image to generate." }),
    model: optionalStringEnum(
      [
        SEEDREAM_DEFAULT_MODEL,
        "seedream-4-5-251128",
        "seedream-4-0-250828",
      ] as const,
      {
        description: `Seedream model ID. Default: ${SEEDREAM_DEFAULT_MODEL}.`,
      },
    ),
    size: optionalStringEnum(["1K", "2K", "4K"] as const, {
      description: "Output resolution. 1K≈1024px, 2K≈2048px, 4K≈4096px. Default: 2K.",
    }),
    aspectRatio: optionalStringEnum(["1:1", "16:9", "9:16", "4:3", "3:4"] as const, {
      description: "Aspect ratio. Default: 1:1.",
    }),
    seed: Type.Optional(
      Type.Number({ description: "Random seed for reproducible generation.", minimum: 0 }),
    ),
    watermark: Type.Optional(
      Type.Boolean({ description: "Add BytePlus watermark. Default: false." }),
    ),
    guidanceScale: Type.Optional(
      Type.Number({
        description: "CFG guidance scale (prompt adherence vs. creativity). Typical: 5–10.",
        minimum: 1,
        maximum: 30,
      }),
    ),
    optimizePrompt: Type.Optional(
      Type.Boolean({ description: "Let the model rewrite the prompt for better results." }),
    ),
    referenceImageUrls: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Up to 5 public HTTP/HTTPS image URLs to use as visual references (image-to-image).",
        maxItems: 5,
      }),
    ),
    sequentialMode: optionalStringEnum(["disabled", "enabled", "strict"] as const, {
      description:
        "Sequential image generation mode when reference images are provided. Default: disabled.",
    }),
  },
  { additionalProperties: false },
);

function resolveBaseUrl(api: OpenClawPluginApi): string {
  const direct =
    api.config?.models?.providers?.[BYTEPLUS_PROVIDER_ID]?.baseUrl?.trim();
  return (direct || DEFAULT_BASE_URL).replace(/\/+$/u, "");
}


async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(
      `Seedream image download failed (${res.status}): ${msg || res.statusText}`,
    );
  }
  const mimeType = res.headers.get("content-type")?.trim() || DEFAULT_MIME;
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType };
}

type SeedreamImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string; code?: string };
};

export function createSeedreamTool(api: OpenClawPluginApi) {
  return {
    name: "seedream_generate",
    label: "Seedream Image Generate",
    description:
      "Generate images using BytePlus Seedream. Supports text-to-image and image-to-image with reference URLs. Returns the saved image file path.",
    parameters: SeedreamToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const apiKey = resolveApiKey(api);
      if (!apiKey) {
        return jsonResult({
          status: "error",
          error:
            "BytePlus API key is not configured. " +
            "Set the BYTEPLUS_API_KEY environment variable before starting OpenClaw: " +
            "export BYTEPLUS_API_KEY=<your_key>. " +
            "Get your key from the BytePlus ARK console: https://console.byteplus.com/ark",
        });
      }

      const prompt = readStringParam(rawParams, "prompt", { required: true });
      const model = readStringParam(rawParams, "model") || SEEDREAM_DEFAULT_MODEL;
      const size = readStringParam(rawParams, "size") || "2K";
      const seed = readNumberParam(rawParams, "seed", { integer: true });
      const guidanceScale = readNumberParam(rawParams, "guidanceScale");
      const watermark =
        typeof rawParams.watermark === "boolean" ? rawParams.watermark : false;
      const optimizePrompt =
        typeof rawParams.optimizePrompt === "boolean" ? rawParams.optimizePrompt : false;
      const referenceImageUrls = Array.isArray(rawParams.referenceImageUrls)
        ? (rawParams.referenceImageUrls as string[]).filter(
            (u): u is string => typeof u === "string" && u.length > 0,
          )
        : [];
      const sequentialMode =
        readStringParam(rawParams, "sequentialMode") || "disabled";

      // Seedream 4.5 does not support 1K
      if (model.includes("4-5") && size === "1K") {
        return jsonResult({
          status: "error",
          error: "Seedream 4.5 does not support 1K resolution; use 2K or 4K.",
        });
      }

      const baseUrl = resolveBaseUrl(api);
      const client = new OpenAI({ apiKey, baseURL: baseUrl });

      const body: Record<string, unknown> = {
        model,
        prompt,
        size,
        response_format: "b64_json",
        watermark,
      };

      if (seed != null) {
        body.seed = seed;
      }
      if (guidanceScale != null) {
        body.guidance_scale = guidanceScale;
      }
      if (optimizePrompt) {
        body.optimize_prompt_options = { enabled: true };
      }
      if (referenceImageUrls.length > 0) {
        const refs = await Promise.all(referenceImageUrls.map(fetchImageBuffer));
        body.image = refs.map(
          (r) => `data:${r.mimeType};base64,${r.buffer.toString("base64")}`,
        );
        body.sequential_image_generation = sequentialMode;
      }

      const payload = await client.post<SeedreamImageResponse>("/images/generations", {
        body,
        timeout: 120_000,
      });

      if (payload.error) {
        return jsonResult({
          status: "error",
          error: `Seedream API error: ${payload.error.message ?? payload.error.code ?? "unknown"}`,
        });
      }

      const entry = payload.data?.[0];
      if (!entry?.b64_json) {
        return jsonResult({
          status: "error",
          error: "Seedream API returned no image data.",
        });
      }

      const buffer = Buffer.from(entry.b64_json, "base64");
      const saved = await saveMediaBuffer(
        buffer,
        DEFAULT_MIME,
        "seedream",
        IMAGE_MAX_BYTES,
        "seedream.png",
      );

      return {
        content: [
          {
            type: "image" as const,
            data: entry.b64_json,
            mimeType: DEFAULT_MIME,
          },
          {
            type: "text" as const,
            text: `Image saved: ${saved.path}`,
          },
        ],
        details: {
          model,
          path: saved.path,
          media: {
            mediaUrls: [saved.path],
          },
        },
      };
    },
  };
}
