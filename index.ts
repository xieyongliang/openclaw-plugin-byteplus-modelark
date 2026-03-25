import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildSeedreamImageGenerationProvider } from "./image-generation-provider.js";
import { buildSeedanceVideoGenerationProvider } from "./video-generation-provider.js";

const PLUGIN_ID = "byteplus-modelark";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "BytePlus ModelArk Media",
  description:
    "Seedream image generation and Seedance video generation via BytePlus ARK API",
  register(api) {
    api.registerImageGenerationProvider(buildSeedreamImageGenerationProvider());
    api.registerVideoGenerationProvider(buildSeedanceVideoGenerationProvider());
  },
});
