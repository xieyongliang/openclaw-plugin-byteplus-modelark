import OpenAI from "openai";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type {
  VideoGenerationProvider,
  VideoGenerationRequest,
  VideoGenerationResult,
  VideoGenerationSourceAsset,
} from "openclaw/plugin-sdk/video-generation";
import { resolveApiKey, resolveBaseUrl } from "./auth.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 600_000;

// Models using the unified content[] API with top-level fields (ratio, duration, watermark).
// Seedance 1.0 models also use content[] but embed params inline in the text prompt instead.
const SEEDANCE_CONTENT_API_MODELS = [
  // Seedance 1.5 Pro
  "seedance-1-5-pro-251215",
  // Seedance 2.0
  "dreamina-seedance-2-0-260128",
  // Seedance 2.0 Fast
  "dreamina-seedance-2-0-fast-260128",
] as const;

const SEEDANCE2_DEFAULT_MODEL = "seedance-1-5-pro-251215";

type ContentGenerationTaskID = { id: string };
type ContentGenerationTask = {
  id: string;
  model: string;
  status: string;
  content?: { video_url?: string };
  error?: { message?: string; code?: string };
};

/** Build the unified content[] array from all input assets + prompt text.
 *
 * Role resolution for images (in priority order):
 *   1. asset.role is set explicitly → use it as-is (e.g. "first_frame", "last_frame", "reference_image")
 *   2. providerOptions.firstFrameImageUrl / lastFrameImageUrl → positionally inject as first_frame/last_frame
 *   3. Positional fallback: images[0] without role → "first_frame", images[1] without role → "last_frame"
 *      when the model commonly expects positional first/last frame (1.5 Pro default behavior).
 *   4. No role → "reference_image" (generic reference, used for 2.0 multi-image scenarios).
 */
function buildContent(params: {
  prompt: string;
  inputImages?: VideoGenerationSourceAsset[];
  inputVideos?: VideoGenerationSourceAsset[];
  inputAudios?: VideoGenerationSourceAsset[];
  /** providerOptions passed down so firstFrameImageUrl/lastFrameImageUrl can inject extra items. */
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  /** When true, positional images[0]/images[1] without explicit role default to first_frame/last_frame. */
  positionalFrameMode?: boolean;
}): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: params.prompt },
  ];

  // Inject providerOptions frame URLs if they are not already covered by inputImages.
  const injectedFirst = params.firstFrameUrl;
  const injectedLast = params.lastFrameUrl;
  const imgUrls = new Set((params.inputImages ?? []).map((img) => img.url).filter(Boolean));

  if (injectedFirst && !imgUrls.has(injectedFirst)) {
    content.push({ type: "image_url", image_url: { url: injectedFirst }, role: "first_frame" });
  }
  if (injectedLast && !imgUrls.has(injectedLast)) {
    content.push({ type: "image_url", image_url: { url: injectedLast }, role: "last_frame" });
  }

  const images = params.inputImages ?? [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const url = img?.url;
    if (!url) continue;

    let role = img.role;
    if (!role && params.positionalFrameMode) {
      // Positional convention: first image → first_frame, second image → last_frame.
      role = i === 0 ? "first_frame" : i === 1 ? "last_frame" : "reference_image";
    }
    content.push({
      type: "image_url",
      image_url: { url },
      role: role ?? "reference_image",
    });
  }

  for (const vid of params.inputVideos ?? []) {
    const url = vid.url;
    if (!url) continue;
    content.push({
      type: "video_url",
      video_url: { url },
      role: vid.role ?? "reference_video",
    });
  }

  for (const aud of params.inputAudios ?? []) {
    const url = aud.url;
    if (!url) continue;
    content.push({
      type: "audio_url",
      audio_url: { url },
      role: aud.role ?? "reference_audio",
    });
  }

  return content;
}

async function createTask(
  client: OpenAI,
  params: {
    model: string;
    content: Array<Record<string, unknown>>;
    aspectRatio: string;
    durationSeconds?: number;
    generateAudio: boolean;
    watermark: boolean;
    seed?: number;
  },
): Promise<string> {
  const body: Record<string, unknown> = {
    model: params.model,
    content: params.content,
    ratio: params.aspectRatio,
    generate_audio: params.generateAudio,
    watermark: params.watermark,
  };

  if (params.durationSeconds != null) body.duration = params.durationSeconds;
  if (params.seed != null) body.seed = params.seed;

  const result = await client.post<ContentGenerationTaskID>("/contents/generations/tasks", {
    body,
  });

  if (!result.id) throw new Error("Seedance 2.0 task creation returned no task ID");
  return result.id;
}

async function pollTask(client: OpenAI, taskId: string, maxWaitMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const task = await client.get<ContentGenerationTask>(
      `/contents/generations/tasks/${taskId}`,
    );
    const status = task.status ?? "unknown";

    if (status === "succeeded" || status === "completed" || status === "done") {
      const videoUrl = task.content?.video_url;
      if (!videoUrl) throw new Error("Seedance 2.0 task completed but returned no video URL");
      return videoUrl;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      throw new Error(`Seedance 2.0 generation failed: ${task.error?.message ?? status}`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Seedance 2.0 generation timed out after ${Math.round(maxWaitMs / 1000)}s`,
  );
}

async function downloadVideoBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Seedance 2.0 video download failed (${res.status}): ${msg || res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export function buildSeedance2VideoProvider(api: OpenClawPluginApi): VideoGenerationProvider {
  return {
    id: "byteplus-seedance2",
    label: "BytePlus Seedance (1.5 Pro / 2.0)",
    defaultModel: SEEDANCE2_DEFAULT_MODEL,
    models: [...SEEDANCE_CONTENT_API_MODELS],
    capabilities: {
      // Supports "adaptive" in addition to standard aspect ratio strings; core passes it as-is.
      supportsAspectRatio: true,
      supportsAudio: true,      // generate_audio
      supportsWatermark: true,
      maxInputImages: 9,
      maxInputVideos: 3,
      maxInputAudios: 3,
      supportedDurationSeconds: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    },
    isConfigured: () => Boolean(resolveApiKey(api)),
    generateVideo: async (req: VideoGenerationRequest): Promise<VideoGenerationResult> => {
      const apiKey = resolveApiKey(api);
      if (!apiKey) {
        throw new Error(
          "BytePlus API key not configured. Set BYTEPLUS_API_KEY before starting OpenClaw.",
        );
      }

      const opts = req.providerOptions ?? {};
      const seed = typeof opts.seed === "number" ? opts.seed : undefined;

      // providerOptions frame URL overrides (compat with Seedance 1.x plugin users).
      const firstFrameUrl = typeof opts.firstFrameImageUrl === "string"
        ? opts.firstFrameImageUrl
        : undefined;
      const lastFrameUrl = typeof opts.lastFrameImageUrl === "string"
        ? opts.lastFrameImageUrl
        : undefined;

      // Positional frame mode: when images have no explicit role and no providerOptions
      // frame URLs are set, treat images[0]/images[1] as first_frame/last_frame.
      // This matches the natural usage pattern for Seedance 1.5 Pro first/last frame.
      const hasRoledImages = (req.inputImages ?? []).some((img) => Boolean(img.role));
      const positionalFrameMode = !hasRoledImages && !firstFrameUrl && !lastFrameUrl;

      const content = buildContent({
        prompt: req.prompt,
        inputImages: req.inputImages,
        inputVideos: req.inputVideos,
        inputAudios: req.inputAudios,
        firstFrameUrl,
        lastFrameUrl,
        positionalFrameMode,
      });

      const client = new OpenAI({ apiKey, baseURL: resolveBaseUrl(api) });

      const taskId = await createTask(client, {
        model: req.model,
        content,
        // "adaptive" is a valid Seedance ratio that auto-detects from the input image dimensions.
        aspectRatio: req.aspectRatio ?? "16:9",
        durationSeconds: req.durationSeconds,
        generateAudio: req.audio ?? false,
        watermark: req.watermark ?? false,
        seed,
      });

      const videoUrl = await pollTask(client, taskId, DEFAULT_MAX_WAIT_MS);
      const buffer = await downloadVideoBuffer(videoUrl);

      return {
        videos: [{ buffer, mimeType: "video/mp4", fileName: `seedance2-${taskId}.mp4` }],
        model: req.model,
        metadata: { taskId },
      };
    },
  };
}
