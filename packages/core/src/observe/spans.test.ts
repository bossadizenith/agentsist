import { describe, expect, test } from "bun:test";

import { spansFromEvents, spansFromSteps } from "./spans";
import type { RuntimeEvent } from "../lib/types";

describe("spansFromSteps", () => {
  test("maps successful and failed steps", () => {
    const spans = spansFromSteps([
      {
        toolCallId: "call_1",
        tool: "webSearchTool",
        input: { query: "ai" },
        output: [],
        success: true,
        durationMs: 100,
      },
      {
        toolCallId: "call_2",
        tool: "githubTool",
        input: { username: "openai" },
        output: null,
        success: false,
        durationMs: 50,
        error: { name: "Error", message: "503" },
      },
    ]);

    expect(spans[0]?.status).toBe("ok");
    expect(spans[1]?.status).toBe("error");
  });
});

describe("spansFromEvents blocked", () => {
  test("records blocked tool span", () => {
    const events: RuntimeEvent[] = [
      {
        type: "tool:blocked",
        runId: "run_1",
        tool: "reportTool",
        requires: ["githubTool"],
      },
    ];

    const spans = spansFromEvents(events);
    expect(spans[0]?.status).toBe("blocked");
  });
});
