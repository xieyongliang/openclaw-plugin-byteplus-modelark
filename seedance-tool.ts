import { Type } from "@sinclair/typebox";
import OpenAI from "openai";
import { jsonResult, readNumberParam, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { saveMediaBuffer } from "openclaw/plugin-sdk/media-runtime";
import { resolveApiKey, resolveBaseUrl } from "./auth.js";
import { SEEDANCE_DEFAULT_MODEL } from "./models.js";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 600_000;
// Video files can be significantly larger than the default 16 MB limit
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

function optionalStringEnum<const T extends readonly string[]>(
  values: T,
  opts: { description?: string } = {},
) {
  return Type.Optional(
    Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...opts }),
  );
}

const SeedanceToolSchema = Type.Object(
  {
    prompt: Type.String({ description: "Text description of the video to generate." }),
    model: optionalStringEnum(
      [
        SEEDANCE_DEFAULT_MODEL,
        "seedance-1-0-pro-250528",
        "seedance-1-0-pro-fast-251015",
        "seedance-1-0-lite-t2v-250428",
        "seedance-1-0-lite-i2v-250428",
      ] as const,
      { description: `Seedance model ID. Default: ${SEEDANCE_DEFAULT_MODEL}.` },
    ),
    durationSeconds: Type.Optional(
      Type.Number({
        description: "Video duration in seconds (4–12). Default: chosen by model.",
        minimum: 4,
        maximum: 12,
      }),
    ),
    aspectRatio: optionalStringEnum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const, {
      description: "Video aspect ratio. Default: 16:9.",
    }),
    resolution: optionalStringEnum(["480p", "720p", "1080p"] as const, {
      description: "Output resolution. Default: 720p (480p when draft=true).",
    }),
    seed: Type.Optional(
      Type.Number({ description: "Random seed for reproducible generation.", minimum: 0 }),
    ),
    watermark: Type.Optional(
      Type.Boolean({ description: "Add BytePlus watermark. Default: false." }),
    ),
    firstFrameImageUrl: Type.Optional(
      Type.String({ description: "Public URL of image to use as the first frame (I2V)." }),
    ),
    lastFrameImageUrl: Type.Optional(
      Type.String({ description: "Public URL of image to use as the last frame." }),
    ),
    camerafixed: Type.Optional(
      Type.Boolean({ description: "Keep camera static throughout the video." }),
    ),
    draft: Type.Optional(
      Type.Boolean({ description: "Draft mode: faster generation at 480p quality." }),
    ),
  },
  { additionalProperties: false },
);




type ContentGenerationTaskID = { id: string };
type ContentGenerationTask = {
  id: string;
  model: string;
  status: string;
  content?: { video_url?: string };
  error?: { message?: string; code?: string };
};

async function createTask(
  client: OpenAI,
  params: {
    model: string;
    prompt: string;
    durationSeconds?: number | null;
    aspectRatio?: string;
    resolution: string;
    seed?: number | null;
    watermark: boolean;
    firstFrameImageUrl?: string;
    lastFrameImageUrl?: string;
    camerafixed?: boolean;
    draft: boolean;
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
    watermark: params.watermark,
    resolution: params.resolution,
  };

  if (params.aspectRatio) {
    body.ratio = params.aspectRatio;
  }
  if (params.durationSeconds != null) {
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

  while (Date.now() - start < maxWaitMs) {
    const task = await client.get<ContentGenerationTask>(
      `/contents/generations/tasks/${taskId}`,
    );
    const status = task.status ?? "unknown";

    if (status === "succeeded" || status === "completed" || status === "done") {
      const videoUrl = task.content?.video_url;
      if (!videoUrl) {
        throw new Error("Seedance task completed but returned no video URL");
      }
      return videoUrl;
    }

    if (status === "failed" || status === "error" || status === "canceled") {
      throw new Error(
        `Seedance video generation failed: ${task.error?.message ?? status}`,
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }

  throw new Error(
    `Seedance video generation timed out after ${Math.round(maxWaitMs / 1000)}s`,
  );
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(
      `Seedance video download failed (${res.status}): ${msg || res.statusText}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export function createSeedanceTool(api: OpenClawPluginApi) {
  return {
    name: "seedance_generate",
    label: "Seedance Video Generate",
    description:
      "Generate videos using BytePlus Seedance. Supports text-to-video and image-to-video (first/last frame). Returns the saved video file path.",
    parameters: SeedanceToolSchema,
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
      const model = readStringParam(rawParams, "model") || SEEDANCE_DEFAULT_MODEL;
      const durationSeconds = readNumberParam(rawParams, "durationSeconds", { integer: true });
      const aspectRatio = readStringParam(rawParams, "aspectRatio") || "16:9";
      const seed = readNumberParam(rawParams, "seed", { integer: true });
      const watermark =
        typeof rawParams.watermark === "boolean" ? rawParams.watermark : false;
      const firstFrameImageUrl = readStringParam(rawParams, "firstFrameImageUrl") || undefined;
      const lastFrameImageUrl = readStringParam(rawParams, "lastFrameImageUrl") || undefined;
      const camerafixed =
        typeof rawParams.camerafixed === "boolean" ? rawParams.camerafixed : undefined;
      const draft = typeof rawParams.draft === "boolean" ? rawParams.draft : false;

      const resolution =
        draft ? "480p" : (readStringParam(rawParams, "resolution") || "720p");

      const baseUrl = resolveBaseUrl(api);
      const client = new OpenAI({ apiKey, baseURL: baseUrl });

      const taskId = await createTask(client, {
        model,
        prompt,
        durationSeconds,
        aspectRatio,
        resolution,
        seed,
        watermark,
        firstFrameImageUrl,
        lastFrameImageUrl,
        camerafixed,
        draft,
      });

      const videoUrl = await pollTask(client, taskId, DEFAULT_MAX_WAIT_MS);
      const buffer = await downloadBuffer(videoUrl);

      const saved = await saveMediaBuffer(
        buffer,
        "video/mp4",
        "seedance",
        VIDEO_MAX_BYTES,
        `seedance-${taskId}.mp4`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Video generated (task ${taskId}) and saved: ${saved.path}`,
          },
        ],
        details: {
          model,
          taskId,
          path: saved.path,
          media: {
            mediaUrls: [saved.path],
          },
        },
      };
    },
  };
}
