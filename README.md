# openclaw-plugin-byteplus-modelark

[OpenClaw](https://github.com/openclaw/openclaw) plugin for **BytePlus ARK API** image and video generation.

- **Seedream** — text-to-image generation (models: Seedream 5.0, 4.5, 4.0)
- **Seedance** — text-to-video and image-to-video generation (models: Seedance 1.5 Pro, 1.0 Pro, 1.0 Lite)

## Installation

```bash
openclaw plugins install openclaw-plugin-byteplus-modelark
```

Or link locally for development:

```bash
git clone https://github.com/xieyongliang/openclaw-plugin-byteplus-modelark.git
cd openclaw-plugin-byteplus-modelark
npm install
openclaw plugins install --link .
```

## Configuration

Set your BytePlus API key:

```bash
export BYTEPLUS_API_KEY="your-api-key"
```

Or configure via OpenClaw:

```bash
openclaw config set models.providers.byteplus.apiKey "your-api-key"
```

Get your API key from the [BytePlus ModelArk Console](https://console.byteplus.com/ark).

## Usage

Once installed, the plugin registers providers for OpenClaw's `image_generate` and `video_generate` agent tools automatically.

### Image generation (Seedream)

```
Generate an image of a mountain landscape at sunrise
```

```
Generate a 4K image of a cute cat with seed 42 and guidance scale 7.5
```

### Video generation (Seedance)

```
Generate a 5 second video of ocean waves crashing on a beach
```

```
Generate a 10 second 1080p video of a cityscape timelapse in 16:9
```

### List available models

```
List all available image generation models
List all available video generation models
```

## Supported Models

### Seedream (Image)

| Model ID | Description |
|---|---|
| `seedream-5-0-260128` | Seedream 5.0 (default) |
| `seedream-4-5-251128` | Seedream 4.5 |
| `seedream-4-0-250828` | Seedream 4.0 |

### Seedance (Video)

| Model ID | Description |
|---|---|
| `seedance-1-5-pro-251215` | Seedance 1.5 Pro (default) |
| `seedance-1-0-pro-250528` | Seedance 1.0 Pro |
| `seedance-1-0-pro-fast-251015` | Seedance 1.0 Pro Fast |
| `seedance-1-0-lite-t2v-250428` | Seedance 1.0 Lite (text-to-video) |
| `seedance-1-0-lite-i2v-250428` | Seedance 1.0 Lite (image-to-video) |

## Supported Parameters

### Image Generation

| Parameter | Type | Description |
|---|---|---|
| `prompt` | string | Text description |
| `model` | string | Model ID (default: `seedream-5-0-260128`) |
| `resolution` | string | `1K`, `2K`, or `4K` (default: `2K`) |
| `seed` | number | Random seed for reproducibility |
| `watermark` | boolean | Add watermark (default: `false`) |
| `guidanceScale` | number | Prompt adherence (1.0-20.0) |
| `optimizePrompt` | boolean | Auto-optimize prompt |
| `inputImages` | image[] | Reference images for editing |

### Video Generation

| Parameter | Type | Description |
|---|---|---|
| `prompt` | string | Text description |
| `model` | string | Model ID (default: `seedance-1-5-pro-251215`) |
| `duration` | number | Duration in seconds (4-12) |
| `aspectRatio` | string | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9` |
| `resolution` | string | `480p`, `720p`, `1080p` (default: `720p`) |
| `seed` | number | Random seed for reproducibility |
| `watermark` | boolean | Add watermark (default: `false`) |
| `firstFrameImageUrl` | string | First frame reference image URL (I2V) |
| `lastFrameImageUrl` | string | Last frame reference image URL (I2V) |
| `camerafixed` | boolean | Fix camera position |
| `draft` | boolean | Draft mode (forces 480p, faster) |

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) >= 2026.3.22 (with core PR [#53681](https://github.com/openclaw/openclaw/pull/53681) merged)
- A [BytePlus](https://www.byteplus.com/) API key with ARK access

## License

MIT
