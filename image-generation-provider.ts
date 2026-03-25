import OpenAI from "openai";
import type {
  GeneratedImageAsset,
  ImageGenerationProvider,
  ImageGenerationResolution,
} from "openclaw/plugin-sdk/image-generation";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth";
import { BYTEPLUS_PROVIDER_ID, SEEDREAM_DEFAULT_MODEL } from "./models.js";

const DEFAULT_SEEDREAM_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const DEFAULT_OUTPUT_MIME = "image/png";

const SEEDREAM_SUPPORTED_RESOLUTIONS: ImageGenerationResolution[] = ["1K", "2K", "4K"];

type SeedreamImageData = {
  url?: string;
  b64_json?: string;
};

type SeedreamImageResponse = {
  data?: SeedreamImageData[];
  error?: { message?: string; code?: string };
  usage?: Record<string, unknown>;
};

function resolveSeedreamBaseUrl(
  cfg: Parameters<typeof resolveApiKeyForProvider>[0]["cfg"],
): string {
  const direct = cfg?.models?.providers?.[BYTEPLUS_PROVIDER_ID]?.baseUrl?.trim();
  return (direct || DEFAULT_SEEDREAM_BASE_URL).replace(/\/+$/u, "");
}

function createArkClient(apiKey: string, baseUrl: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: baseUrl });
}

function mapResolutionToSize(resolution: ImageGenerationResolution | undefined): string {
  if (!resolution) {
    return "2K";
  }
  return resolution;
}

function mapSizeStringToResolution(size: string | undefined): string | undefined {
  const trimmed = size?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^[124]K$/iu.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const match = /^(\d{2,5})x(\d{2,5})$/iu.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const longestEdge = Math.max(
    Number.parseInt(match[1] ?? "", 10),
    Number.parseInt(match[2] ?? "", 10),
  );
  if (longestEdge >= 3072) {
    return "4K";
  }
  if (longestEdge >= 1536) {
    return "2K";
  }
  return "1K";
}

function fileExtFromMime(mimeType: string | undefined): string {
  const normalized = mimeType?.toLowerCase().trim();
  if (!normalized) {
    return "png";
  }
  if (normalized.includes("jpeg")) {
    return "jpg";
  }
  const slashIndex = normalized.indexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) || "png" : "png";
}

async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Seedream image download failed (${response.status}): ${text || response.statusText}`,
    );
  }
  const mimeType = response.headers.get("content-type")?.trim() || DEFAULT_OUTPUT_MIME;
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

function buildReferenceImageEntries(
  inputImages: Array<{ buffer: Buffer; mimeType: string }> | undefined,
): string[] | undefined {
  if (!inputImages || inputImages.length === 0) {
    return undefined;
  }
  return inputImages.map((img) => {
    const base64 = img.buffer.toString("base64");
    return `data:${img.mimeType};base64,${base64}`;
  });
}

export function buildSeedreamImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: BYTEPLUS_PROVIDER_ID,
    label: "Seedream",
    defaultModel: SEEDREAM_DEFAULT_MODEL,
    models: [SEEDREAM_DEFAULT_MODEL, "seedream-4-5-251128", "seedream-4-0-250828"],
    capabilities: {
      generate: {
        maxCount: 1,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      edit: {
        enabled: true,
        maxInputImages: 5,
      },
      geometry: {
        sizes: ["1024x1024", "2048x2048", "4096x4096"],
        resolutions: SEEDREAM_SUPPORTED_RESOLUTIONS,
        aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      },
    },
    async generateImage(req) {
      const auth = await resolveApiKeyForProvider({
        provider: BYTEPLUS_PROVIDER_ID,
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("BytePlus API key missing");
      }

      const model = req.model?.trim() || SEEDREAM_DEFAULT_MODEL;
      const baseUrl = resolveSeedreamBaseUrl(req.cfg);

      const sizeFromExplicit = mapSizeStringToResolution(req.size);
      const size = sizeFromExplicit || mapResolutionToSize(req.resolution);

      if (model.includes("4-5") && size === "1K") {
        throw new Error("Seedream 4.5 does not support 1K resolution; use 2K or 4K");
      }

      const useB64 = true;
      const client = createArkClient(auth.apiKey, baseUrl);

      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        size,
        response_format: useB64 ? "b64_json" : "url",
        watermark: req.watermark ?? false,
      };

      if (req.seed != null) {
        body.seed = req.seed;
      }
      if (req.guidanceScale != null) {
        body.guidance_scale = req.guidanceScale;
      }
      if (req.optimizePrompt) {
        body.optimize_prompt_options = { enabled: true };
      }

      const refImages = buildReferenceImageEntries(req.inputImages);
      if (refImages) {
        body.image = refImages;
        body.sequential_image_generation =
          (req.providerOptions?.sequential as string) ?? "disabled";
        if (req.providerOptions?.sequentialOptions) {
          body.sequential_image_generation_options = req.providerOptions.sequentialOptions;
        }
      }

      const payload = await client.post<SeedreamImageResponse>("/images/generations", {
        body,
        timeout: req.timeoutMs ?? 120_000,
      });

      if (payload.error) {
        throw new Error(
          `Seedream API error: ${payload.error.message ?? payload.error.code ?? "unknown"}`,
        );
      }

      const images: GeneratedImageAsset[] = [];
      let imageIndex = 0;
      for (const entry of payload.data ?? []) {
        imageIndex += 1;
        if (useB64 && entry.b64_json) {
          const buffer = Buffer.from(entry.b64_json, "base64");
          images.push({
            buffer,
            mimeType: DEFAULT_OUTPUT_MIME,
            fileName: `image-${imageIndex}.png`,
          });
        } else if (entry.url) {
          const downloaded = await fetchImageBuffer(entry.url);
          images.push({
            buffer: downloaded.buffer,
            mimeType: downloaded.mimeType,
            fileName: `image-${imageIndex}.${fileExtFromMime(downloaded.mimeType)}`,
          });
        }
      }

      if (images.length === 0) {
        throw new Error("Seedream image generation response missing image data");
      }

      return { images, model };
    },
  };
}
