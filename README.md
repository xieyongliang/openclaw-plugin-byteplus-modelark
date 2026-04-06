# openclaw-plugin-byteplus-modelark

[OpenClaw](https://github.com/openclaw/openclaw) plugin for the **BytePlus ARK API** — language models, image generation, and video generation.

| Capability | Models |
|---|---|
| **Language models** | Seed 2.0 Pro / Lite, Seed 1.8, Kimi K2.5, GLM 4.7, Ark Code |
| **Image generation** | Seedream 5.0, 4.5, 4.0 |
| **Video generation** | Seedance 1.5 Pro, 2.0, 2.0 Fast, 1.0 Pro, 1.0 Lite |

All capabilities share a single `BYTEPLUS_API_KEY`.

---

## Installation

```bash
openclaw plugins install xieyongliang-byteplus-modelark
```

Restart the OpenClaw gateway (via the Mac app, or `openclaw gateway run`) after installation.

For local development:

```bash
git clone https://github.com/xieyongliang/openclaw-plugin-byteplus-modelark.git
cd openclaw-plugin-byteplus-modelark
npm install
openclaw plugins install --link .
```

---

## Configuration

Get your API key from the [BytePlus ARK Console](https://console.byteplus.com/ark).

### Option A — Onboarding wizard (recommended)

```bash
openclaw onboard
# → Select "BytePlus ModelArk" → enter your BytePlus ARK API key
```

This writes `models.providers.byteplus-modelark.apiKey` to your config.

### Option B — Plugin config

```bash
# API key (all capabilities read this first)
openclaw config set plugins.entries.@xieyongliang/byteplus-modelark.config.apiKey YOUR_API_KEY

# Override base URL (for China region)
openclaw config set plugins.entries.@xieyongliang/byteplus-modelark.config.baseUrl https://ark.cn-beijing.bytedance.com/api/v3
```

### Option C — Environment variable

```bash
export BYTEPLUS_API_KEY="your-api-key"
# Optional: override base URL
export BYTEPLUS_BASE_URL="https://ark.cn-beijing.bytedance.com/api/v3"
```

### Key resolution order

For all three capabilities (LLM / Seedream / Seedance), the API key is resolved in this order:

1. `plugins.entries.@xieyongliang/byteplus-modelark.config.apiKey` (plugin config)
2. `models.providers.byteplus-modelark.apiKey` (set by `openclaw onboard`)
3. `BYTEPLUS_API_KEY` environment variable

---

## Language Models

### Supported models

#### Provider `byteplus-modelark` (general)

| Model ID | Name | Modality | Context |
|---|---|---|---|
| `seed-2-0-pro-260328` | Seed 2.0 Pro (default) | text + image | 256K |
| `seed-2-0-lite-260228` | Seed 2.0 Lite | text + image | 256K |
| `seed-1-8-251228` | Seed 1.8 | text + image | 256K |
| `kimi-k2-5` | Kimi K2.5 | text | 131K |
| `glm-4-7` | GLM 4.7 | text + image | 128K |

#### Provider `byteplus-modelark-plan` (coding/planning)

| Model ID | Name | Modality | Context |
|---|---|---|---|
| `ark-code-latest` | Ark Code (Latest) | text | 256K |

### Set default model

```bash
# Set as your global default
openclaw config set models.default byteplus-modelark/seed-2-0-pro-260328

# Or in OpenClaw web UI: Settings → Models → Default Model
```

### Usage

**Command line:**

```bash
openclaw agent --model byteplus-modelark/seed-2-0-pro-260328 \
  --message "Summarize the key points of microservices architecture"
```

**In a conversation (TUI or web):**

```
What is the capital of France?
```

```
Using seed-2-0-lite, summarize this article in 3 bullet points: ...
```

**Deep thinking (Seed models):**

```
--thinking high: Prove that there are infinitely many prime numbers
```

```
--thinking medium: Analyze the pros and cons of this architecture diagram
```

---

## Image Generation (Seedream)

### Supported models

| Model ID | Description |
|---|---|
| `byteplus/seedream-5-0-260128` | Seedream 5.0 (default) |
| `byteplus/seedream-4-5-251128` | Seedream 4.5 |
| `byteplus/seedream-4-0-250828` | Seedream 4.0 |

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | — | Text description of the image |
| `model` | string | `seedream-5-0-260128` | Model ID |
| `resolution` | string | `2K` | `1K`, `2K`, or `4K` |
| `seed` | number | random | Fixed seed for reproducible results |
| `watermark` | boolean | `false` | Add watermark to output |
| `guidanceScale` | number | — | Prompt adherence strength (1.0–20.0) |
| `optimizePrompt` | boolean | `false` | Auto-enhance prompt before generation |
| `inputImages` | image[] | — | Reference images for image-based generation |

### Usage

**Command line:**

```bash
openclaw agent --message "Generate a photorealistic image of a misty mountain lake at sunrise"
```

**With parameters (in conversation):**

```
Generate a 4K image of a futuristic cityscape at night, watermark off, seed 42
```

```
Generate an image using seedream-4-5, guidance scale 8, with this reference image: [attach image]
```

**TUI / Web:**

Open the TUI (`openclaw tui`) or web UI (`openclaw web`) and type your prompt directly. Attach reference images via the paperclip icon in the web UI or drag-and-drop in the TUI.

---

## Video Generation (Seedance)

Videos are generated asynchronously. The agent queues the task and delivers the result as a direct video URL (no file upload, no size limits).

### Supported models

| Model ID | Provider ID | Type | Max images | Max videos | Max audios |
|---|---|---|---|---|---|
| `byteplus/seedance-1-5-pro-251215` | `byteplus-seedance15` | T2V + I2V | **2** (first + last frame) | — | — |
| `byteplus/dreamina-seedance-2-0-260128` | `byteplus-seedance2` | T2V + I2V | **9** | **3** | **3** |
| `byteplus/dreamina-seedance-2-0-fast-260128` | `byteplus-seedance2` | T2V + I2V | **9** | **3** | **3** |
| `byteplus/seedance-1-0-pro-250528` | `byteplus` | T2V + I2V | **2** (first + last frame) | — | — |
| `byteplus/seedance-1-0-pro-fast-251015` | `byteplus` | T2V + I2V | **2** (first + last frame) | — | — |
| `byteplus/seedance-1-0-lite-t2v-250428` | `byteplus` | T2V only | — | — | — |
| `byteplus/seedance-1-0-lite-i2v-250428` | `byteplus` | I2V only | **2** (first + last frame) | — | — |

### Set default video model

```bash
# Set in OpenClaw config (persisted)
openclaw config set tools.videoGeneration.defaultModel byteplus/seedance-1-5-pro-251215
```

### Standard parameters

These are passed directly to the `video_generate` tool:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `prompt` | string | — | Text description |
| `model` | string | `seedance-1-5-pro-251215` | Model ID (prefix `byteplus/` optional) |
| `durationSeconds` | number | — | Duration in seconds (4–10) |
| `aspectRatio` | string | — | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9` |
| `resolution` | string | `720p` | `480p`, `720p`, `1080p` |
| `images` | image[] | — | Input reference images (for I2V) |
| `imageRoles` | string[] | — | Semantic role per image: `first_frame`, `last_frame`, `reference_image` |
| `filename` | string | — | Output filename |

### Seedance-specific parameters via `providerOptions`

Low-level controls are passed through `providerOptions` and forwarded to the Seedance API as-is:

| Key | Type | Default | Description |
|---|---|---|---|
| `seed` | number | random | Fixed seed for reproducible results |
| `watermark` | boolean | `false` | Add watermark to output |
| `camerafixed` | boolean | `false` | Lock camera position (no camera movement) |
| `draft` | boolean | `false` | Draft mode: forces 480p, faster generation |
| `firstFrameImageUrl` | string | — | URL of first-frame reference image (1.0 models) |
| `lastFrameImageUrl` | string | — | URL of last-frame reference image (1.0 models) |

### Text-to-video (T2V)

**Command line:**

```bash
BYTEPLUS_API_KEY=your-key openclaw agent \
  --message "Generate a 5 second 16:9 720p video: golden wheat fields swaying in the breeze at sunset"
```

**In conversation (TUI/web):**

```
Generate a 5 second video of ocean waves crashing on a rocky shore, 16:9, 720p
```

```
Make a 10 second 1080p timelapse of a city at night with no watermark, seed 42
```

**With providerOptions:**

```
Generate a 5 second video of a spinning galaxy, use providerOptions: {"seed": 123, "camerafixed": true}
```

### Image-to-video (I2V) — Seedance 1.5 Pro

Seedance 1.5 Pro supports **at most 2 input images**: first_frame and last_frame.

**In conversation:**

```
Generate a video starting from [attach image], mark it as first_frame, 5 seconds, 720p
```

```
Generate a video transitioning from [image A] to [image B] — first image is first_frame, second is last_frame
```

### Image-to-video and multi-reference — Seedance 2.0

Seedance 2.0 supports up to **9 reference images**, **3 reference videos**, and **3 reference audios**.

**In conversation:**

```
Generate a 5 second video using dreamina-seedance-2-0-260128, with these 3 reference images [attach]
```

### Image-to-video (I2V) — Seedance 1.0 models

Seedance 1.0 models support **at most 2 input images** (first_frame + last_frame) via `providerOptions`:

```
Generate a 5 second video using seedance-1-0-pro-250528, providerOptions: {
  "firstFrameImageUrl": "https://example.com/frame.jpg"
}
```

### Draft mode (faster generation)

```
Generate a quick draft video of a robot walking through a forest, draft mode
```

Draft mode forces 480p and skips quality refinement passes, reducing wait time significantly.

### Usage in TUI

```bash
openclaw tui
# → Type your video generation prompt in the message box
# → The agent queues the task; the video URL is delivered as a message when ready
```

### Usage in Web UI

```bash
openclaw web
# → Open http://localhost:PORT in a browser
# → Type your prompt; attach reference images via the paperclip icon
# → The generated video URL is returned as a clickable link in the chat
```

### Usage via command line (non-interactive)

```bash
# Basic T2V
BYTEPLUS_API_KEY=your-key openclaw agent \
  --session-id vid-$(date +%s) \
  --message "Generate a 5 second video: aurora borealis over a snowy tundra, 16:9 720p"

# With explicit model and providerOptions
BYTEPLUS_API_KEY=your-key openclaw agent \
  --session-id vid-$(date +%s) \
  --message "Generate a 5 second video of daisy fields, model byteplus/seedance-1-0-lite-t2v-250428, aspectRatio 16:9, resolution 720p, providerOptions {\"seed\": 42, \"watermark\": false}"
```

> **Note:** Video generation is asynchronous and takes 60–300 seconds. In `--message` (non-interactive) mode, the CLI may exit before the result is delivered. Use the TUI or web UI for reliable end-to-end delivery, or run the gateway in the background with the Mac app.

---

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) >= 2026.3.22
- A [BytePlus](https://www.byteplus.com/) API key with ARK access (Southeast Asia region by default; China region requires `baseUrl` override)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `API key not configured` | No key found | Set via `openclaw onboard` or `BYTEPLUS_API_KEY` env var |
| Plugin not loaded | Gateway not restarted | Restart via OpenClaw Mac app |
| Video generation times out | Long-running async task | Use TUI or web UI instead of `--message` mode |
| `model not found` error | Wrong model ID format | Prefix model ID with `byteplus/` or omit prefix entirely |
| China region API errors | Wrong base URL | Set `baseUrl` to `https://ark.cn-beijing.bytedance.com/api/v3` |

---

## License

MIT
