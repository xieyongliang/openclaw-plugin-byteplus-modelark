import OpenAI from "openai";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
} from "openclaw/plugin-sdk/video-generation";
import { resolveApiKey, resolveBaseUrl } from "./auth.js";
import { SEEDANCE_1_0_DEFAULT_MODEL } from "./models.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 600_000;

const SEEDANCE_MODELS = [
  "seedance-1-0-pro-t2v-250528",
  "seedance-1-0-pro-250528",
  "seedance-1-0-pro-fast-251015",
  "seedance-1-0-lite-t2v-250428",
  "seedance-1-0-lite-i2v-250428",
] as const;

type ContentGenerationTaskID = { id: string };
type ContentGenerationTask = {
  id: string;
  model: string;
  status: string;
  content?: { video_url?: string };
  error?: { message?: string; code?: string };
};

/**
 * Build the inline parameter suffix for Seedance 1.0 models.
 * All control params are embedded in the text prompt string, e.g.:
 *   "--ratio 16:9  --resolution 720p  --duration 5  --camerafixed false  --watermark true"
 *
 * Note: for I2V models, --ratio is omitted when not explicitly requested (the API infers
 * the ratio from the input image dimensions in that case).
 */
function buildInlineParams(params: {
  aspectRatio?: string;
  resolution: string;
  durationSeconds?: number;
  camerafixed?: boolean;
  watermark: boolean;
  draft: boolean;
}): string {
  const parts: string[] = [];
  // Only include --ratio when explicitly set (T2V always sets it; I2V may omit it).
  if (params.aspectRatio) parts.push(`--ratio ${params.aspectRatio}`);
  const resolution = params.draft ? "480p" : params.resolution;
  parts.push(`--resolution ${resolution}`);
  if (params.durationSeconds != null) parts.push(`--duration ${params.durationSeconds}`);
  if (params.camerafixed != null) parts.push(`--camerafixed ${params.camerafixed}`);
  parts.push(`--watermark ${params.watermark}`);
  return parts.join("  ");
}

async function createSeedanceTask(
  client: OpenAI,
  params: {
    model: string;
    prompt: string;
    durationSeconds?: number;
    aspectRatio: string;
    resolution: string;
    seed?: number;
    watermark: boolean;
    firstFrameImageUrl?: string;
    lastFrameImageUrl?: string;
    camerafixed?: boolean;
    draft: boolean;
  },
): Promise<string> {
  // Seedance 1.0 embeds control params as inline text flags; append them to the prompt.
  const inlineParams = buildInlineParams({
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    durationSeconds: params.durationSeconds,
    camerafixed: params.camerafixed,
    watermark: params.watermark,
    draft: params.draft,
  });
  const textWithParams = `${params.prompt}  ${inlineParams}`;

  const content: Array<Record<string, unknown>> = [{ type: "text", text: textWithParams }];

  if (params.firstFrameImageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: params.firstFrameImageUrl },
      role: "first_frame",
    });
  }
  if (params.lastFrameImageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: params.lastFrameImageUrl },
      role: "last_frame",
    });
  }

  const body: Record<string, unknown> = {
    model: params.model,
    content,
  };

  // seed is the only remaining top-level field for Seedance 1.0.
  if (params.seed != null) body.seed = params.seed;

  const result = await client.post<ContentGenerationTaskID>("/contents/generations/tasks", {
    body,
  });

  if (!result.id) {
    throw new Error("Seedance task creation returned no task ID");
  }
  return result.id;
}

async function pollSeedanceTask(
  client: OpenAI,
  taskId: string,
  maxWaitMs: number,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const task = await client.get<ContentGenerationTask>(
      `/contents/generations/tasks/${taskId}`,
    );
    const status = task.status ?? "unknown";

    if (status === "succeeded" || status === "completed" || status === "done") {
      const videoUrl = task.content?.video_url;
      if (!videoUrl) throw new Error("Seedance task completed but returned no video URL");
      return videoUrl;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      throw new Error(`Seedance video generation failed: ${task.error?.message ?? status}`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }
  throw new Error(`Seedance video generation timed out after ${Math.round(maxWaitMs / 1000)}s`);
}


export function buildSeedanceVideoProvider(api: OpenClawPluginApi): VideoGenerationProvider {
  return {
    id: "byteplus",
    label: "BytePlus Seedance",
    defaultModel: SEEDANCE_1_0_DEFAULT_MODEL,
    models: [...SEEDANCE_MODELS],
    capabilities: {
      providerOptions: {
        seed: "number",
        draft: "boolean",
        // Matches the JSON-body API field name (camera_fixed); legacy text mode uses --camerafixed.
        camera_fixed: "boolean",
      },
      supportsAspectRatio: true,
      supportsResolution: true,
      supportsWatermark: true,
      // seedance-1-0-lite-i2v-250428 supports up to 4 reference images (role: reference_image).
      // Other 1.0 models accept at most 2 images (first_frame + last_frame).
      maxInputImages: 4,
      // Seedance 1.0 pro/lite support 2–12s; Seedance 1.5 pro supports 4–12s.
      supportedDurationSeconds: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    },
    isConfigured: () => Boolean(resolveApiKey(api)),
    generateVideo: async (req: VideoGenerationRequest): Promise<VideoGenerationResult> => {
      const apiKey = resolveApiKey(api);
      if (!apiKey) {
        throw new Error(
          "BytePlus API key not configured. Set BYTEPLUS_API_KEY before starting OpenClaw.",
        );
      }

      // Pull Seedance-specific options out of providerOptions (passed via video_generate tool).
      // All keys are optional; unknown keys are silently ignored.
      const opts = req.providerOptions ?? {};
      const seed = typeof opts.seed === "number" ? opts.seed : undefined;
      const draft = opts.draft === true;
      // providerOptions key is camera_fixed (matching the JSON body API field).
      // The legacy text flag embedded in the prompt is still --camerafixed.
      const camerafixed = typeof opts.camera_fixed === "boolean" ? opts.camera_fixed : undefined;

      // Resolve first/last frame URLs from three sources (in priority order):
      //   1. providerOptions.firstFrameImageUrl / lastFrameImageUrl (explicit override)
      //   2. inputImages entries with role === "first_frame" / "last_frame"
      //   3. positional fallback: inputImages[0] → first frame, inputImages[1] → last frame
      const byRole = (role: string) =>
        req.inputImages?.find((img) => img.role === role)?.url;

      const firstFrameImageUrl =
        (typeof opts.firstFrameImageUrl === "string" ? opts.firstFrameImageUrl : undefined) ??
        byRole("first_frame") ??
        req.inputImages?.[0]?.url;

      const lastFrameImageUrl =
        (typeof opts.lastFrameImageUrl === "string" ? opts.lastFrameImageUrl : undefined) ??
        byRole("last_frame") ??
        (req.inputImages && req.inputImages.length > 1 ? req.inputImages[1]?.url : undefined);

      // resolution: draft mode forces 480p; otherwise use the standard req.resolution field.
      const resolution = draft
        ? "480p"
        : (req.resolution?.toLowerCase() ?? "720p");

      const client = new OpenAI({ apiKey, baseURL: resolveBaseUrl(api) });

      // For I2V models (inputImages present), omit --ratio when the user hasn't explicitly set
      // one so Seedance can infer the ratio from the input image dimensions.
      const hasInputImages = (req.inputImages?.length ?? 0) > 0;
      const aspectRatio = req.aspectRatio ?? (hasInputImages ? undefined : "16:9");

      const taskId = await createSeedanceTask(client, {
        model: req.model,
        prompt: req.prompt,
        durationSeconds: req.durationSeconds,
        aspectRatio,
        resolution,
        seed,
        watermark: req.watermark ?? false,
        firstFrameImageUrl,
        lastFrameImageUrl,
        camerafixed,
        draft,
      });

      // Return the pre-signed TOS URL directly instead of downloading the file.
      // This avoids channel file-size limits: the delivery layer sends the URL
      // (as a MEDIA: link) rather than attaching the raw bytes.
      const videoUrl = await pollSeedanceTask(client, taskId, DEFAULT_MAX_WAIT_MS);

      return {
        videos: [{ url: videoUrl, mimeType: "video/mp4", fileName: `seedance-${taskId}.mp4` }],
        model: req.model,
        metadata: { taskId },
      };
    },
  };
}
