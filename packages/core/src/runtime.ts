import type { RuntimeConfig, RuntimeEvent, ToolRegistry } from "./lib/types";
import { createAgent } from "./agent";
import { resumeRun } from "./replay";
import { createRunHandle } from "./run";
import { createInitialRunState, fileStorage } from "./storage-fs";

export type AgentsistRuntime = ReturnType<typeof createAgentsistRuntime>;

export function createAgentsistRuntime(config: RuntimeConfig = {}) {
  const storage = config.storage ?? fileStorage();
  const emit: ((event: RuntimeEvent) => void) | undefined =
    config.onRunEvent ?? config.onEvent;

  const internals = {
    config,
    storage,
    emit,
  };

  const runInternals = {
    config,
    emit,
    save: (state: Parameters<typeof storage.save>[0]) => storage.save(state),
  };

  return {
    agent<TOOLS extends ToolRegistry>(
      definition: Parameters<typeof createAgent<TOOLS>>[0],
    ) {
      return createAgent(definition, internals);
    },

    tools<TOOLS extends ToolRegistry>(registry: TOOLS): TOOLS {
      return registry;
    },

    async createRun(options: Parameters<typeof createInitialRunState>[0]) {
      const state = createInitialRunState(options);
      await storage.save(state);
      return createRunHandle(state, runInternals);
    },

    async loadRun(runId: string) {
      const state = await storage.load(runId);
      return createRunHandle(state, runInternals);
    },

    async replayRun(
      runId: string,
      execute: (run: ReturnType<typeof createRunHandle>) => Promise<void>,
    ) {
      const run = await this.loadRun(runId);
      await resumeRun(run, execute);
    },
  };
}
