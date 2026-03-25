import OpenAI from "openai";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth";
import type {
  GeneratedVideoAsset,
  VideoGenerationProvider,
} from "openclaw/plugin-sdk/video-generation";
import { BYTEPLUS_PROVIDER_ID, SEEDANCE_DEFAULT_MODEL } from "./models.js";

const DEFAULT_SEEDANCE_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 600_000;

type ContentGenerationTaskID = {
  id: string;
};

type ContentGenerationTask = {
  id: string;
  model: string;
  status: string;
  content?: { video_url?: string; last_frame_url?: string };
  error?: { message?: string; code?: string };
};

function resolveSeedanceBaseUrl(
  cfg: Parameters<typeof resolveApiKeyForProvider>[0]["cfg"],
): string {
  const direct = cfg?.models?.providers?.[BYTEPLUS_PROVIDER_ID]?.baseUrl?.trim();
  return (direct || DEFAULT_SEEDANCE_BASE_URL).replace(/\/+$/u, "");
}

function createArkClient(apiKey: string, baseUrl: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: baseUrl });
}

async function createTask(
  client: OpenAI,
  params: {
    model: string;
    prompt: string;
    durationSeconds?: number;
    aspectRatio?: string;
    resolution?: string;
    seed?: number;
    watermark?: boolean;
    firstFrameImageUrl?: string;
    lastFrameImageUrl?: string;
    camerafixed?: boolean;
    draft?: boolean;
  },
): Promise<string> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: params.prompt }];

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
    watermark: params.watermark ?? false,
  };

  if (params.resolution) {
    body.resolution = params.resolution;
  }
  if (params.aspectRatio) {
    body.ratio = params.aspectRatio;
  }
  if (params.durationSeconds) {
    body.duration = params.durationSeconds;
  }
  if (params.seed != null) {
    body.seed = params.seed;
  }
  if (params.camerafixed != null) {
    body.camerafixed = params.camerafixed;
  }
  if (params.draft) {
    body.draft = true;
  }

  const result = await client.post<ContentGenerationTaskID>("/contents/generations/tasks", {
    body,
  });

  if (!result.id) {
    throw new Error("Seedance task creation returned no task ID");
  }
  return result.id;
}

async function pollTask(client: OpenAI, taskId: string, maxWaitMs: number): Promise<string> {
  const start = Date.now();
  let lastStatus: string | undefined;

  while (Date.now() - start < maxWaitMs) {
    const task = await client.get<ContentGenerationTask>(`/contents/generations/tasks/${taskId}`);
    const status = task.status ?? "unknown";

    if (status !== lastStatus) {
      lastStatus = status;
    }

    if (status === "succeeded" || status === "completed" || status === "done") {
      const videoUrl = task.content?.video_url;
      if (!videoUrl) {
        throw new Error("Seedance task completed but returned no video URL");
      }
      return videoUrl;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      throw new Error(`Seedance video generation failed: ${task.error?.message ?? status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }

  throw new Error(`Seedance video generation timed out after ${Math.round(maxWaitMs / 1000)}s`);
}

async function downloadVideo(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Seedance video download failed (${response.status}): ${text || response.statusText}`,
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function buildSeedanceVideoGenerationProvider(): VideoGenerationProvider {
  return {
    id: BYTEPLUS_PROVIDER_ID,
    label: "Seedance",
    defaultModel: SEEDANCE_DEFAULT_MODEL,
    models: [
      SEEDANCE_DEFAULT_MODEL,
      "seedance-1-0-pro-250528",
      "seedance-1-0-pro-fast-251015",
      "seedance-1-0-lite-t2v-250428",
      "seedance-1-0-lite-i2v-250428",
    ],
    capabilities: {
      supportsDuration: true,
      supportsAspectRatio: true,
      supportsResolution: true,
      minDurationSeconds: 4,
      maxDurationSeconds: 12,
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
      resolutions: ["480p", "720p", "1080p"],
    },
    async generateVideo(req) {
      const auth = await resolveApiKeyForProvider({
        provider: BYTEPLUS_PROVIDER_ID,
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("BytePlus API key missing");
      }

      const model = req.model?.trim() || SEEDANCE_DEFAULT_MODEL;
      const baseUrl = resolveSeedanceBaseUrl(req.cfg);
      const maxWait = req.timeoutMs ?? DEFAULT_MAX_WAIT_MS;

      const client = createArkClient(auth.apiKey, baseUrl);

      const firstFrameUrl = req.firstFrameImage?.url;
      const lastFrameUrl = req.lastFrameImage?.url;
      const camerafixed = req.providerOptions?.camerafixed as boolean | undefined;
      const draft = req.providerOptions?.draft as boolean | undefined;

      const effectiveResolution = draft ? "480p" : (req.resolution ?? "720p");

      const taskId = await createTask(client, {
        model,
        prompt: req.prompt,
        durationSeconds: req.durationSeconds,
        aspectRatio: req.aspectRatio ?? "16:9",
        resolution: effectiveResolution,
        seed: req.seed,
        watermark: req.watermark,
        firstFrameImageUrl: firstFrameUrl,
        lastFrameImageUrl: lastFrameUrl,
        camerafixed,
        draft,
      });

      const videoUrl = await pollTask(client, taskId, maxWait);

      const buffer = await downloadVideo(videoUrl);
      const videos: GeneratedVideoAsset[] = [
        {
          buffer,
          mimeType: "video/mp4",
          fileName: `video-${taskId}.mp4`,
          metadata: { taskId, videoUrl },
        },
      ];

      return { videos, model };
    },
  };
}
