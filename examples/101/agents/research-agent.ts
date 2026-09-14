import { groq } from "@ai-sdk/groq";
import { agentsist, fileStorage, type RuntimeEvent } from "agentsist";
import {
  DEFAULT_MODEL_ID,
  GROQ_STREAM_OPTIONS,
  SYSTEM_PROMPT,
} from "../lib/const";
import { githubTool } from "../tools/github";
import { reportTool } from "../tools/report";
import { webSearchTool } from "../tools/search";

export function createResearchAgent(options?: {
  onEvent?: (event: RuntimeEvent) => void;
}) {
  const runtime = agentsist({
    storage: fileStorage("./runs/demo"),
    onEvent: options?.onEvent,
  });

  return runtime.agent({
    name: "research",
    model: groq(DEFAULT_MODEL_ID),
    system: SYSTEM_PROMPT,
    ...GROQ_STREAM_OPTIONS,
    tools: {
      webSearchTool: { tool: webSearchTool },
      githubTool: { tool: githubTool, retry: 3, critical: true },
      reportTool: { tool: reportTool, requires: ["githubTool"] },
    },
  });
}

export const researchAgent = createResearchAgent();
