import type {
  OnStepFinishEvent,
  StreamTextOnStepFinishCallback,
  ToolSet,
} from "ai";

import type {
  RunHooksOptions,
  RunState,
  RunStepFinishEvent,
  RunSummary,
  RuntimeConfig,
  ToolRegistry,
} from "./lib/types";
import { applyStepUsage } from "./lib/usage";
import {
  withRunGate,
  withToolCritical,
  withToolEvents,
  withToolRequires,
  withToolRetry,
  withToolStateCapture,
} from "./middleware";

export type RunHandle = {
  readonly runId: string;
  readonly model: string;
  readonly query: string;
  readonly messages: RunState["messages"];
  readonly state: RunState;
  bindTools<TOOLS extends ToolRegistry>(
    tools: TOOLS,
  ): { [K in keyof TOOLS]: TOOLS[K]["tool"] };
  hooks<TOOLS extends ToolSet = ToolSet>(options?: RunHooksOptions<TOOLS>): {
    onFinish: (params: { text: string }) => Promise<void>;
    onStepFinish: StreamTextOnStepFinishCallback<TOOLS>;
  };
  save: () => Promise<void>;
  abort: (reason: string) => void;
};

type RuntimeInternals = {
  config: RuntimeConfig;
  emit: RuntimeConfig["onEvent"];
  save: (state: RunState) => Promise<void>;
};

export function createRunHandle(
  state: RunState,
  internals: RuntimeInternals,
): RunHandle {
  const saveState = () => internals.save(state);

  const abort = (reason: string) => {
    if (state.status !== "running" && state.status !== "error") return;

    state.status = "interrupted";
    state.completedAt = new Date().toISOString();
    void saveState();
    internals.emit?.({
      type: "run:abort",
      runId: state.runId,
      reason,
    });
  };

  return {
    runId: state.runId,
    model: state.model,
    query: state.query,
    messages: state.messages,
    state,
    abort,
    save: saveState,

    bindTools<TOOLS extends ToolRegistry>(tools: TOOLS) {
      const bound = {} as { [K in keyof TOOLS]: TOOLS[K]["tool"] };

      for (const [name, policy] of Object.entries(tools)) {
        let tool = policy.tool;

        if (policy.retry) {
          tool = withToolRetry(name, state.runId, tool, policy.retry, (event) =>
            internals.emit?.(event),
          );
        }

        if (policy.requires?.length) {
          tool = withToolRequires(
            name,
            state.runId,
            tool,
            policy.requires,
            state,
            (event) => internals.emit?.(event),
          );
        }

        tool = withToolEvents(name, state.runId, tool, (event) =>
          internals.emit?.(event),
        );

        tool = withToolStateCapture(name, tool, state, saveState);

        if (policy.critical) {
          tool = withToolCritical(
            name,
            state.runId,
            tool,
            (reason) => abort(reason),
            (event) => internals.emit?.(event),
          );
        }

        tool = withRunGate(tool, state);

        bound[name as keyof TOOLS] = tool as TOOLS[keyof TOOLS]["tool"];
      }

      return bound;
    },

    hooks<TOOLS extends ToolSet = ToolSet>(options?: RunHooksOptions<TOOLS>) {
      const userOnStepFinish = options?.onStepFinish;

      const onStepFinish = async (step: OnStepFinishEvent<TOOLS>) => {
        const cost = applyStepUsage(
          state,
          state.model,
          step.usage,
          step.toolCalls,
        );
        await saveState();

        if (userOnStepFinish) {
          const event = Object.assign(step, { cost }) as RunStepFinishEvent<TOOLS>;
          await userOnStepFinish(event);
        }
      };

      return {
        onStepFinish: onStepFinish as StreamTextOnStepFinishCallback<TOOLS>,
        onFinish: async ({ text }) => {
          if (state.status !== "running") return;

          if (text) {
            state.messages.push({ role: "assistant", content: text });
          }

          state.status = "completed";
          state.completedAt = new Date().toISOString();
          await saveState();

          const summary: RunSummary = {
            runId: state.runId,
            status: state.status,
            totalTokens: state.totalTokens,
            totalCostUsd: state.totalCostUsd,
            costByTool: state.costByTool,
            stepCount: state.steps.length,
          };

          internals.emit?.({
            type: "run:complete",
            runId: state.runId,
            summary,
          });
        },
      };
    },
  };
}
