import { describe, expect, test } from "bun:test";
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { agentsist } from "./index";
import { fileStorage } from "./storage-fs";

function mockUsage() {
  return {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 1,
      text: 1,
      reasoning: undefined,
    },
  };
}

describe("agent.resume", () => {
  test("resumes an interrupted run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentsist-resume-"));

    const model = new MockLanguageModelV3({
      modelId: "mock-model",
      doGenerate: async () => {
        if (model.doGenerateCalls.length === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "call_github",
                toolName: "githubTool",
                input: JSON.stringify({ username: "openai" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: mockUsage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "resumed" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: mockUsage(),
          warnings: [],
        };
      },
    });

    const runtime = agentsist({ storage: fileStorage(dir) });
    const agent = runtime.agent({
      name: "research",
      model,
      tools: {
        githubTool: {
          tool: tool({
            description: "github",
            inputSchema: z.object({ username: z.string() }),
            execute: async () => {
              throw new Error("503");
            },
          }),
          retry: { maxRetries: 1, delayMs: 0 },
          critical: true,
        },
      },
    });

    const interrupted = await agent.generate({
      input: "fetch repos",
      workflow: { name: "resume-test", runId: "run_resume_test" },
    });
    expect(interrupted.status).toBe("interrupted");

    const resumed = await agent.resume("run_resume_test");
    expect(resumed.id).toBe("run_resume_test");
    expect(resumed.observe.traceId).toBe(interrupted.observe.traceId);
  });
});
