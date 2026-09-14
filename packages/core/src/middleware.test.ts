import { describe, expect, test } from "bun:test";
import { tool } from "ai";

import { RunAbortedError, ToolRequiresError } from "./errors";
import { createRunHandle } from "./run";
import { createInitialRunState } from "./storage-fs";
import type { RuntimeEvent } from "./lib/types";

function toolCall(messages: unknown[] = []) {
  return {
    toolCallId: "call_test",
    messages,
  };
}

function createHarness() {
  const events: RuntimeEvent[] = [];
  const state = createInitialRunState({
    query: "test",
    model: "llama-3.3-70b-versatile",
  });

  const run = createRunHandle(state, {
    config: {},
    emit: (event) => events.push(event),
    save: async () => {},
  });

  return { run, state, events };
}

describe("withToolRetry", () => {
  test("retries until success", async () => {
    const { run, events } = createHarness();
    let attempts = 0;

    const tools = run.bindTools({
      flaky: {
        tool: tool({
          description: "flaky",
          inputSchema: undefined,
          execute: async () => {
            attempts++;
            if (attempts < 3) throw new Error("transient");
            return "ok";
          },
        }),
        retry: { maxRetries: 3, delayMs: 0 },
      },
    });

    const result = await tools.flaky.execute!({}, toolCall());
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(events.filter((e) => e.type === "tool:retry")).toHaveLength(2);
    expect(events.some((e) => e.type === "tool:complete")).toBe(true);
  });
});

describe("withToolCritical", () => {
  test("aborts run after exhausted retries", async () => {
    const { run, state, events } = createHarness();

    const tools = run.bindTools({
      criticalTool: {
        tool: tool({
          description: "always fails",
          inputSchema: undefined,
          execute: async () => {
            throw new Error("boom");
          },
        }),
        retry: { maxRetries: 2, delayMs: 0 },
        critical: true,
      },
    });

    await expect(tools.criticalTool.execute!({}, toolCall())).rejects.toThrow(
      "boom",
    );
    expect(state.status).toBe("interrupted");
    expect(events.some((e) => e.type === "run:abort")).toBe(true);
  });
});

describe("withRunGate", () => {
  test("blocks tools after run is interrupted", async () => {
    const { run, state } = createHarness();

    const tools = run.bindTools({
      anyTool: {
        tool: tool({
          description: "ok",
          inputSchema: undefined,
          execute: async () => "ok",
        }),
      },
    });

    state.status = "interrupted";

    await expect(tools.anyTool.execute!({}, toolCall())).rejects.toThrow(
      RunAbortedError,
    );
  });
});

describe("withToolRequires", () => {
  test("blocks tool when dependency never ran", async () => {
    const { run, events } = createHarness();

    const tools = run.bindTools({
      reportTool: {
        tool: tool({
          description: "report",
          inputSchema: undefined,
          execute: async () => "written",
        }),
        requires: ["githubTool"],
      },
    });

    await expect(tools.reportTool.execute!({}, toolCall())).rejects.toThrow(
      ToolRequiresError,
    );
    expect(events.some((e) => e.type === "tool:blocked")).toBe(true);
  });

  test("blocks tool when dependency failed", async () => {
    const { run, state, events } = createHarness();

    state.steps.push({
      toolCallId: "call_github",
      tool: "githubTool",
      input: { username: "openai" },
      output: null,
      success: false,
      durationMs: 10,
      error: { name: "Error", message: "503" },
    });

    const tools = run.bindTools({
      reportTool: {
        tool: tool({
          description: "report",
          inputSchema: undefined,
          execute: async () => "written",
        }),
        requires: ["githubTool"],
      },
    });

    await expect(tools.reportTool.execute!({}, toolCall())).rejects.toThrow(
      ToolRequiresError,
    );
    const blocked = events.find((e) => e.type === "tool:blocked");
    expect(blocked?.type === "tool:blocked" && blocked.requires).toEqual([
      "githubTool",
    ]);
  });

  test("allows tool when dependency succeeded", async () => {
    const { run, state } = createHarness();

    state.steps.push({
      toolCallId: "call_github",
      tool: "githubTool",
      input: { username: "openai" },
      output: [{ name: "gpt-4" }],
      success: true,
      durationMs: 10,
    });

    const tools = run.bindTools({
      reportTool: {
        tool: tool({
          description: "report",
          inputSchema: undefined,
          execute: async () => "written",
        }),
        requires: ["githubTool"],
      },
    });

    await expect(tools.reportTool.execute!({}, toolCall())).resolves.toBe(
      "written",
    );
  });
});
