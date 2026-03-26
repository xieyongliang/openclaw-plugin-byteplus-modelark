import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createSeedanceTool } from "./seedance-tool.js";
import { createSeedreamTool } from "./seedream-tool.js";

export default definePluginEntry({
  id: "openclaw-plugin-byteplus-modelark",
  name: "BytePlus ModelArk Media",
  description:
    "Seedream image generation and Seedance video generation via BytePlus ARK API",
  register(api) {
    api.registerTool(createSeedreamTool(api) as AnyAgentTool);
    api.registerTool(createSeedanceTool(api) as AnyAgentTool);
  },
});
