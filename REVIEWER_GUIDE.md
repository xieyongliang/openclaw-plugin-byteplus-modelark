# Reviewer Guide — openclaw-plugin-byteplus-modelark

## What This Plugin Does

An OpenClaw plugin that adds two new media generation providers via the BytePlus ARK API:

- **Seedream** — image generation (text-to-image, image editing with reference images)
- **Seedance** — video generation (text-to-video, image-to-video)

This is the first video generation provider for OpenClaw.

## Quick Setup (5 minutes)

### Prerequisites

- OpenClaw >= 2026.3.22 (latest `main` branch)
- A BytePlus API key ([console.byteplus.com/ark](https://console.byteplus.com/ark))
- Node.js 22+

### Step 1: Unzip and install dependencies

```bash
unzip openclaw-plugin-byteplus-modelark.zip -d ~/openclaw-plugin-byteplus-modelark
cd ~/openclaw-plugin-byteplus-modelark
npm install
```

### Step 2: Set API key

```bash
export BYTEPLUS_API_KEY="your-api-key-here"
```

### Step 3: Link plugin to OpenClaw

```bash
cd /path/to/openclaw
openclaw plugins install --link ~/openclaw-plugin-byteplus-modelark
```

Or if running from source:

```bash
pnpm openclaw plugins install --link ~/openclaw-plugin-byteplus-modelark
```

### Step 4: Verify plugin loaded

```bash
openclaw plugins list
```

You should see `byteplus-modelark` in the list with status `loaded`.

## Test Cases

### Test 1: List image generation models

```bash
openclaw agent --local --session-id review-img-list \
  --message "Call image_generate with action=list"
```

**Expected**: Output includes `byteplus` provider with models:
- `seedream-5-0-260128` (default)
- `seedream-4-5-251128`
- `seedream-4-0-250828`

### Test 2: Generate an image

```bash
openclaw agent --local --session-id review-img-gen \
  --message "Generate an image of a mountain landscape at sunrise"
```

**Expected**: Agent calls `image_generate`, Seedream API returns an image, saved to `~/.openclaw/media/`.

### Test 3: List video generation models

```bash
openclaw agent --local --session-id review-vid-list \
  --message "Call video_generate with action=list"
```

**Expected**: Output includes `byteplus` provider with models:
- `seedance-1-5-pro-251215` (default)
- `seedance-1-0-pro-250528`
- `seedance-1-0-pro-fast-251015`
- `seedance-1-0-lite-t2v-250428`
- `seedance-1-0-lite-i2v-250428`

### Test 4: Generate a video

```bash
openclaw agent --local --session-id review-vid-gen \
  --message "Generate a 5 second video of ocean waves crashing on a beach at sunset"
```

**Expected**: Agent calls `video_generate`, creates async task, polls until complete (~1-3 min), downloads MP4, saved to `~/.openclaw/media/`.

### Test 5: Draft mode (fast, lower quality)

```bash
openclaw agent --local --session-id review-vid-draft \
  --message "Generate a 5 second draft video of a cat playing with a ball"
```

**Expected**: Video generated at 480p, faster than normal mode.

## File Overview

| File | Lines | Purpose |
|---|---|---|
| `index.ts` | 16 | Plugin entry — registers image + video providers |
| `models.ts` | 6 | Constants (provider ID, default models, env vars) |
| `image-generation-provider.ts` | 220 | Seedream image generation via OpenAI-compatible client |
| `video-generation-provider.ts` | 220 | Seedance video generation (async task creation + polling) |
| `openclaw.plugin.json` | 11 | Plugin manifest (ID, auth env vars, config schema) |
| `package.json` | 48 | npm package definition |
| `README.md` | — | User-facing documentation |
| `DEVELOPMENT.md` | — | Development process documentation |

## Architecture Notes

- Uses the `openai` npm package as an HTTP client (BytePlus ARK API is OpenAI-compatible)
- Seedream: synchronous request-response (`POST /images/generations`)
- Seedance: async task polling (`POST /contents/generations/tasks` → `GET .../tasks/{id}` every 3s)
- Auth: reuses existing `BYTEPLUS_API_KEY` via `resolveApiKeyForProvider()`
- All imports from `openclaw/plugin-sdk/*` (proper plugin SDK boundaries)

## Known Limitations

- Video generation typically takes 1-3 minutes (async API)
- Seedream 4.5 does not support 1K resolution
- I2V (image-to-video) requires publicly accessible image URLs for first/last frame
- The `providerOptions` fields (`sequential`, `camerafixed`, `draft`) are provider-specific and may not be exposed in all agent UIs

## Core Changes Required

This plugin requires the following changes to OpenClaw core, submitted as:

**Core PR: [#53681](https://github.com/openclaw/openclaw/pull/53681)** — `feat: add video generation core infrastructure and extend image generation parameters`

Changes in that PR:

1. `VideoGenerationRequest` — new fields: `seed`, `watermark`, `firstFrameImage`, `lastFrameImage`, `providerOptions`
2. `ImageGenerationRequest` — new fields: `seed`, `watermark`, `guidanceScale`, `optimizePrompt`, `providerOptions`
3. `video-generate-tool.ts` — new `video_generate` agent tool with schema params and 200MB `maxBytes` for video saves
4. `image-generate-tool.ts` — new tool schema params (`seed`, `watermark`, `guidanceScale`, `optimizePrompt`)
5. `common.ts` — new `readBooleanParam()` helper
6. Plugin SDK — new `openclaw/plugin-sdk/video-generation` export with `VideoGenerationSourceImage` type
7. Plugin registry — `registerVideoGenerationProvider` API and related contract/test updates
