import { groq } from "@ai-sdk/groq";

export const DEFAULT_MODEL_ID = "meta-llama/llama-4-scout-17b-16e-instruct";

export const DEMO_TASK =
  "Search for the top 5 AI companies in 2026, fetch their GitHub repos, and write a report.";

export const AGENT_A_REPORT_PATH = "reports/agent-a-report.md";
export const AGENT_B_REPORT_PATH = "reports/agent-b-report.md";

export function resolveModel(modelId: string) {
  return groq(modelId);
}

export const GROQ_STREAM_OPTIONS = {
  providerOptions: {
    groq: { parallelToolCalls: false },
  },
} as const;

export const SYSTEM_PROMPT = `You are a research assistant.

When asked to research AI companies you MUST follow this exact order:
1. webSearchTool — find the top AI companies and their GitHub organization names
2. githubTool — fetch public repos for each GitHub org from the search results
3. reportTool — write the final markdown report to disk

Do not call githubTool or reportTool until webSearchTool has completed.
Never skip tools or invent data. If a tool fails, say so clearly.`;
