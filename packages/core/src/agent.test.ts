import { describe, expect, test } from "bun:test";
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { resolvePrompt } from "./agent";
import { agentsist } from "./index";
import { spansFromEvents } from "./observe/spans";
import { fileStorage } from "./storage-fs";
import type { RuntimeEvent } from "./lib/types";

function mockUsage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: undefined,
    },
  };
}

function mockToolCallStep(toolName: string, input: Record<string, unknown>) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `call_${toolName}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: mockUsage(),
    warnings: [],
  };
}

function mockTextStep(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: mockUsage(),
    warnings: [],
  };
}

describe("resolvePrompt", () => {
  test("accepts input sugar", () => {
    expect(resolvePrompt({ input: "hello" }, "fallback")).toBe("hello");
  });

  test("rejects multiple prompt sources", () => {
    expect(() =>
      resolvePrompt({ input: "a", prompt: "b" }, "fallback"),
    ).toThrow("only one");
  });
});

describe("spansFromEvents", () => {
  test("records tool lifecycle", () => {
    const events: RuntimeEvent[] = [
      { type: "tool:start", runId: "run_1", tool: "githubTool", input: {} },
      {
        type: "tool:failure",
        runId: "run_1",
        tool: "githubTool",
        error: { name: "Error", message: "503" },
        durationMs: 12,
      },
    ];

    const spans = spansFromEvents(events);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe("error");
    expect(spans[0]?.error).toBe("503");
  });
});

describe("runtime.agent", () => {
  test("generate returns trace + interrupted on critical tool", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentsist-agent-"));
    const runtime = agentsist({ storage: fileStorage(dir) });

    const model = new MockLanguageModelV3({
      modelId: "mock-model",
      doGenerate: async () => {
        if (model.doGenerateCalls.length === 1) {
          return mockToolCallStep("githubTool", { username: "openai" });
        }
        return mockTextStep("done");
      },
    });

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
          retry: { maxRetries: 2, delayMs: 0 },
          critical: true,
        },
      },
    });

    const run = await agent.generate({
      input: "fetch repos",
      workflow: { name: "test", runId: "run_test_agent" },
    });

    expect(run.id).toBe("run_test_agent");
    expect(run.status).toBe("interrupted");
    expect(run.observe.traceId).toMatch(/^trace_/);
    expect(run.failure?.type).toBe("policy");
    expect(run.observe.spans.some((span) => span.name === "githubTool")).toBe(
      true,
    );

    const saved = JSON.parse(
      readFileSync(join(dir, "run_test_agent.json"), "utf-8"),
    );
    expect(saved.workflowName).toBe("test");
    expect(saved.agentName).toBe("research");
  });

  test("blocks report when dependency never succeeded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentsist-requires-"));
    const events: RuntimeEvent[] = [];

    const model = new MockLanguageModelV3({
      modelId: "mock-model",
      doGenerate: async () => {
        if (model.doGenerateCalls.length === 1) {
          return mockToolCallStep("reportTool", { path: "out.md", content: "x" });
        }
        return mockTextStep("done");
      },
    });

    const runtimeWithEvents = agentsist({
      storage: fileStorage(dir),
      onEvent: (event) => events.push(event),
    });

    const blockedAgent = runtimeWithEvents.agent({
      name: "research",
      model,
      tools: {
        reportTool: {
          tool: tool({
            description: "report",
            inputSchema: z.object({
              path: z.string(),
              content: z.string(),
            }),
            execute: async () => "written",
          }),
          requires: ["githubTool"],
        },
      },
    });

    const run = await blockedAgent.generate({ input: "write report" });
    expect(events.some((event) => event.type === "tool:blocked")).toBe(true);
    expect(run.observe.spans.some((span) => span.status === "blocked")).toBe(
      true,
    );
  });
});
