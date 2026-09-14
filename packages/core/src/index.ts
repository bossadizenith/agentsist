import type {
  AgentDefinition,
  AgentRunOptions,
  AgentRunResult,
  CreateRunOptions,
  RunHooksOptions,
  RunState,
  RunStepFinishEvent,
  RunSummary,
  RuntimeConfig,
  RuntimeEvent,
  Step,
  Storage,
  ToolPolicy,
  ToolRegistry,
  ToolRetryPolicy,
} from "./lib/types";
import type { Agent } from "./agent";
import { resumeRun } from "./replay";
import type { RunHandle } from "./run";
import { createAgentsistRuntime } from "./runtime";

export type {
  AgentDefinition,
  AgentRunOptions,
  AgentRunResult,
  AgentWorkflow,
  CreateRunOptions,
  ModelPricingKey,
  ObserveConfig,
  ObserveSnapshot,
  RunFailure,
  RunHooksOptions,
  RunState,
  RunStepFinishEvent,
  RunSummary,
  RuntimeConfig,
  RuntimeEvent,
  Span,
  Step,
  StepCostSnapshot,
  Storage,
  ToolPolicy,
  ToolRegistry,
  ToolRetryPolicy,
};

export type { Agent } from "./agent";
export type { RunHandle } from "./run";
export type { AgentsistRuntime } from "./runtime";

export { resolvePrompt } from "./agent";
export { calculateCost } from "./lib/cost";
export { ModelPricing } from "./lib/const";
export { GENERATION_COST_KEY, applyStepUsage } from "./lib/usage";
export { resumeRun } from "./replay";
export { RunAbortedError, ToolRequiresError } from "./errors";
export { fileStorage, RunNotFoundError } from "./storage-fs";

export function agentsist(config: RuntimeConfig = {}) {
  return createAgentsistRuntime(config);
}

/** @deprecated Use `agentsist()` */
export function createRuntime(config: RuntimeConfig = {}) {
  return createAgentsistRuntime(config);
}

export const runtime = agentsist();
