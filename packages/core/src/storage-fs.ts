import { mkdirSync, readFileSync, writeFileSync } from "fs";

import type { RunState, Step, Storage } from "./lib/types";

export class RunNotFoundError extends Error {
  readonly runId: string;
  readonly path: string;

  constructor(runId: string, path: string) {
    super(`Run not found: ${runId} (expected ${path})`);
    this.name = "RunNotFoundError";
    this.runId = runId;
    this.path = path;
  }
}

export function fileStorage(dir = "./runs"): Storage {
  return {
    async save(state) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        `${dir}/${state.runId}.json`,
        JSON.stringify(state, null, 2),
      );
    },

    async load(runId) {
      const path = `${dir}/${runId}.json`;

      let raw: string;
      try {
        raw = readFileSync(path, "utf-8");
      } catch (error) {
        if (isEnoent(error)) {
          throw new RunNotFoundError(runId, path);
        }
        throw error;
      }

      try {
        return normalizeRunState(JSON.parse(raw));
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`Invalid run file: ${path}`);
        }
        throw error;
      }
    },
  };
}

function normalizeRunState(raw: unknown): RunState {
  const state = raw as RunState;

  if (typeof state.model === "object" && state.model !== null) {
    const legacyModel = state.model as { modelId?: string };
    if (legacyModel.modelId) {
      state.model = legacyModel.modelId;
    }
  }

  if (!state.traceId) {
    state.traceId = `trace_${state.runId}`;
  }

  if (!state.spans) {
    state.spans = [];
  }

  return state;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function createInitialRunState({
  query,
  model,
  agentName,
  traceId,
  workflowName,
  workflowRunId,
  sessionId,
  metadata,
}: {
  query: string;
  model: string;
  agentName?: string;
  traceId?: string;
  workflowName?: string;
  workflowRunId?: string;
  sessionId?: string;
  metadata?: Record<string, string>;
}): RunState {
  const runId = `run_${Date.now()}`;

  return {
    schemaVersion: 1,
    runId,
    startDate: new Date().toISOString(),
    status: "running",
    steps: [] as Step[],
    query,
    model,
    agentName,
    traceId: traceId ?? `trace_${runId}`,
    workflowName,
    workflowRunId,
    sessionId,
    metadata,
    messages: [],
    spans: [],
    costByTool: {},
    totalCostUsd: 0,
    totalTokens: 0,
  };
}
