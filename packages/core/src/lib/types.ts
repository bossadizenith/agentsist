import type {
  ModelMessage,
  OnStepFinishEvent,
  ToolExecuteFunction,
  TypedToolCall,
  Tool,
  ToolSet,
} from "ai";

import type { ModelPricing } from "./const";

export type RunSummary = {
  runId: string;
  status: RunState["status"];
  totalTokens: number;
  totalCostUsd: number;
  costByTool: RunState["costByTool"];
  stepCount: number;
};

export type RuntimeEvent =
  | {
      type: "tool:start";
      runId: string;
      tool: string;
      input: unknown;
    }
  | {
      type: "tool:complete";
      runId: string;
      tool: string;
      output: unknown;
      durationMs: number;
    }
  | {
      type: "tool:failure";
      runId: string;
      tool: string;
      error: SerializedError;
      durationMs: number;
    }
  | {
      type: "tool:retry";
      runId: string;
      tool: string;
      attempt: number;
      max: number;
      error: SerializedError;
    }
  | {
      type: "tool:blocked";
      runId: string;
      tool: string;
      requires: string[];
    }
  | {
      type: "run:complete";
      runId: string;
      summary: RunSummary;
    }
  | {
      type: "run:abort";
      runId: string;
      reason: string;
      tool?: string;
      error?: SerializedError;
    };

export type ToolRetryPolicy =
  | number
  | {
      maxRetries?: number;
      delayMs?: number;
    };

export type ToolPolicy = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: Tool<any, any>;
  retry?: ToolRetryPolicy;
  critical?: boolean;
  requires?: string[];
};

export type ToolRegistry = Record<string, ToolPolicy>;

export type Storage = {
  save: (state: RunState) => Promise<void>;
  load: (runId: string) => Promise<RunState>;
};

export type RuntimeConfig = {
  onEvent?: (event: RuntimeEvent) => void;
  storage?: Storage;
};

export type CreateRunOptions = {
  query: string;
  model: string;
};

export type ToolMiddlewareFunction<INPUT, OUTPUT> = (
  next: ToolExecuteFunction<INPUT, OUTPUT>,
) => ToolExecuteFunction<INPUT, OUTPUT>;

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
};

export type Step = {
  toolCallId: string;
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  success: boolean;
  durationMs: number;
  error?: SerializedError;
};

export type RunStatus = "running" | "completed" | "error" | "interrupted";

export type RunState = {
  schemaVersion: 1;
  runId: string;
  query: string;
  model: string;
  startDate: string;
  completedAt?: string;
  status: RunStatus;
  failedStepIndex?: number;
  messages: ModelMessage[];
  steps: Step[];
  costByTool: CostByTool;
  totalCostUsd: number;
  totalTokens: number;
};

export type AppToolCall = TypedToolCall<Record<string, Tool<unknown, unknown>>>;

export type CostEntry = {
  tool: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  model: string;
};

export type CostByTool = Record<string, number>;

export type CostSummary = {
  runId: string;
  totalCost: number;
  totalTokens: number;
  costByTool: CostByTool;
};

export type ModelPricingKey = keyof typeof ModelPricing;

export type StepCostSnapshot = {
  stepCost: number;
  totalCostUsd: number;
  totalTokens: number;
  costByTool: CostByTool;
};

export type RunStepFinishEvent<TOOLS extends ToolSet = ToolSet> =
  OnStepFinishEvent<TOOLS> & {
    cost: StepCostSnapshot;
  };

export type RunHooksOptions<TOOLS extends ToolSet = ToolSet> = {
  onStepFinish?: (event: RunStepFinishEvent<TOOLS>) => PromiseLike<void> | void;
};
