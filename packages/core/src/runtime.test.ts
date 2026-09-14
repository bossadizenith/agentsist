import { describe, expect, test } from "bun:test";

import { agentsist, createRuntime } from "./index";

describe("agentsist bootstrap", () => {
  test("agentsist exposes agent()", () => {
    const runtime = agentsist();
    expect(typeof runtime.agent).toBe("function");
    expect(typeof runtime.createRun).toBe("function");
  });

  test("createRuntime remains backward compatible", () => {
    const runtime = createRuntime();
    expect(typeof runtime.agent).toBe("function");
    expect(typeof runtime.tools).toBe("function");
  });
});
