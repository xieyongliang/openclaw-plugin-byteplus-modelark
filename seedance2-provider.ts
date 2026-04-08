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

// Seedance 1.5 Pro: unified content[] API, max 2 input images (first_frame + last_frame only).
const SEEDANCE15_MODELS = ["seedance-1-5-pro-251215"] as const;
const SEEDANCE15_DEFAULT_MODEL = "seedance-1-5-pro-251215";

// Seedance 2.0: unified content[] API, up to 9 reference images, 3 videos, 3 audios.
const SEEDANCE2_MODELS = [
  "dreamina-seedance-2-0-260128",
  "dreamina-seedance-2-0-fast-260128",
] as const;
const SEEDANCE2_DEFAULT_MODEL = "dreamina-seedance-2-0-260128";

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
    camera_fixed?: boolean;
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
  if (params.camera_fixed != null) body.camera_fixed = params.camera_fixed;

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

/** Shared generate logic used by both the 1.5 Pro and 2.0 providers. */
async function generateVideoInternal(
  req: VideoGenerationRequest,
  api: OpenClawPluginApi,
): Promise<VideoGenerationResult> {
  const apiKey = resolveApiKey(api);
  if (!apiKey) {
    throw new Error(
      "BytePlus API key not configured. Set BYTEPLUS_API_KEY before starting OpenClaw.",
    );
  }

  const opts = req.providerOptions ?? {};
  const seed = typeof opts.seed === "number" ? opts.seed : undefined;
  const cameraFixed = typeof opts.camera_fixed === "boolean" ? opts.camera_fixed : undefined;

  const firstFrameUrl = typeof opts.firstFrameImageUrl === "string"
    ? opts.firstFrameImageUrl
    : undefined;
  const lastFrameUrl = typeof opts.lastFrameImageUrl === "string"
    ? opts.lastFrameImageUrl
    : undefined;

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
    aspectRatio: req.aspectRatio ?? "16:9",
    durationSeconds: req.durationSeconds,
    generateAudio: req.audio ?? false,
    watermark: req.watermark ?? false,
    seed,
    camera_fixed: cameraFixed,
  });

  const videoUrl = await pollTask(client, taskId, DEFAULT_MAX_WAIT_MS);
  const buffer = await downloadVideoBuffer(videoUrl);

  return {
    videos: [{ buffer, mimeType: "video/mp4", fileName: `seedance2-${taskId}.mp4` }],
    model: req.model,
    metadata: { taskId },
  };
}

/**
 * Seedance 1.5 Pro provider.
 * Supports at most 2 input images (first_frame + last_frame only).
 * No video or audio reference inputs.
 * Supported duration: 4–12 s (per official docs).
 */
export function buildSeedance15VideoProvider(api: OpenClawPluginApi): VideoGenerationProvider {
  return {
    id: "byteplus-seedance15",
    label: "BytePlus Seedance 1.5 Pro",
    defaultModel: SEEDANCE15_DEFAULT_MODEL,
    models: [...SEEDANCE15_MODELS],
    capabilities: {
      providerOptions: {
        seed: "number",
        camera_fixed: "boolean",
      },
      supportsAspectRatio: true,
      supportsAudio: true,
      supportsWatermark: true,
      // 1.5 Pro accepts at most 2 images: first_frame and last_frame.
      maxInputImages: 2,
      // Official docs: 4~12 s for Seedance 1.5 Pro.
      supportedDurationSeconds: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    },
    isConfigured: () => Boolean(resolveApiKey(api)),
    generateVideo: (req: VideoGenerationRequest) => generateVideoInternal(req, api),
  };
}

/**
 * Seedance 2.0 provider (Dreamina/即梦 platform models).
 *
 * NOTE: As of April 2026, Seedance 2.0 does NOT support API invocation via the BytePlus
 * ModelArk public API. See: https://docs.byteplus.com/en/docs/ModelArk/1366799
 * The `dreamina-seedance-2-0-*` models are served via the Dreamina/即梦 platform and are
 * not accessible through the standard ARK_API_KEY endpoint.
 *
 * This provider is retained for forward compatibility and will throw at runtime until
 * official API support is announced.
 */
export function buildSeedance2VideoProvider(api: OpenClawPluginApi): VideoGenerationProvider {
  return {
    id: "byteplus-seedance2",
    label: "BytePlus Seedance 2.0 (not yet API-accessible)",
    defaultModel: SEEDANCE2_DEFAULT_MODEL,
    models: [...SEEDANCE2_MODELS],
    capabilities: {
      providerOptions: {
        seed: "number",
      },
      supportsAspectRatio: true,
      supportsAudio: true,
      supportsWatermark: true,
      maxInputImages: 9,
      maxInputVideos: 3,
      maxInputAudios: 3,
      supportedDurationSeconds: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    },
    isConfigured: () => Boolean(resolveApiKey(api)),
    generateVideo: (_req: VideoGenerationRequest): Promise<VideoGenerationResult> => {
      throw new Error(
        "Seedance 2.0 is not yet available via the BytePlus ModelArk public API. " +
          "See https://docs.byteplus.com/en/docs/ModelArk/1366799 for updates.",
      );
    },
  };
}

