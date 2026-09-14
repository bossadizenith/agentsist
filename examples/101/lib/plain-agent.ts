import { calculateCost } from "agentsist";
import { isLoopFinished, streamText } from "ai";
import fs from "node:fs/promises";
import { githubTool } from "../tools/github";
import { reportTool } from "../tools/report";
import { webSearchTool } from "../tools/search";
import {
  AGENT_A_REPORT_PATH,
  DEFAULT_MODEL_ID,
  GROQ_STREAM_OPTIONS,
  SYSTEM_PROMPT,
  resolveModel,
} from "./const";
import type { AgentSummary } from "./format-demo";
import { trackTools, type ToolRunRecord } from "./tool-tracker";

export async function runPlainAgent(prompt: string): Promise<AgentSummary> {
  const records: ToolRunRecord[] = [];

  const tools = trackTools(
    {
      webSearchTool,
      githubTool,
      reportTool,
    },
    (record) => records.push(record),
  );

  let inputTokens = 0;
  let outputTokens = 0;

  const result = streamText({
    model: resolveModel(DEFAULT_MODEL_ID),
    system: SYSTEM_PROMPT,
    tools,
    messages: [{ role: "user", content: prompt }],
    stopWhen: isLoopFinished(),
    ...GROQ_STREAM_OPTIONS,
    onStepFinish: ({ usage }) => {
      inputTokens += usage.inputTokens ?? 0;
      outputTokens += usage.outputTokens ?? 0;
    },
  });

  try {
    for await (const _chunk of result.textStream) {
    }
  } catch {}

  const totalCostUsd = calculateCost(
    DEFAULT_MODEL_ID,
    inputTokens,
    outputTokens,
  );

  let reportExcerpt: string | undefined;
  try {
    const content = await fs.readFile(AGENT_A_REPORT_PATH, "utf-8");
    reportExcerpt =
      content.slice(0, 400).trim() + (content.length > 400 ? "…" : "");
  } catch {}

  const githubFailed = records.some(
    (record) => record.tool === "githubTool" && record.status === "failure",
  );
  const reportWritten = records.some(
    (record) => record.tool === "reportTool" && record.status === "success",
  );

  return {
    label: "Agent A (no agentsist)",
    records,
    totalCostUsd,
    status: reportWritten ? "completed" : githubFailed ? "error" : "running",
    reportPath: reportWritten ? AGENT_A_REPORT_PATH : undefined,
    reportExcerpt,
    message: githubFailed
      ? "Report may include hallucinated GitHub data — user never knows the data is fake."
      : undefined,
  };
}
