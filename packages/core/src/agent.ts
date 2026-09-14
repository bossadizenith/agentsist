import {
  generateText,
  isLoopFinished,
  streamText,
  type ModelMessage,
  type StreamTextResult,
  type ToolSet,
} from "ai";

import type {
  AgentDefinition,
  AgentRunOptions,
  AgentRunResult,
  RuntimeConfig,
  RuntimeEvent,
  Storage,
  ToolRegistry,
} from "./lib/types";
import {
  createSpanId,
  createTraceId,
  mergeSpans,
  spansFromEvents,
  spansFromSteps,
} from "./observe/spans";
import { resumeRun } from "./replay";
import { createRunHandle, type RunHandle } from "./run";
import { createInitialRunState } from "./storage-fs";

type AgentInternals = {
  config: RuntimeConfig;
  storage: Storage;
  emit?: (event: RuntimeEvent) => void;
};

export type Agent<TOOLS extends ToolRegistry = ToolRegistry> = {
  readonly name: string;
  readonly tools: TOOLS;
  generate(options: AgentRunOptions): Promise<AgentRunResult>;
  stream(
    options: AgentRunOptions,
  ): Promise<StreamTextResult<ToolSet, never> & { run: AgentRunResult }>;
  resume(runId: string, options?: AgentRunOptions): Promise<AgentRunResult>;
};

export function createAgent<TOOLS extends ToolRegistry>(
  definition: AgentDefinition & { tools: TOOLS },
  internals: AgentInternals,
): Agent<TOOLS> {
  const events: RuntimeEvent[] = [];

  const emit = (event: RuntimeEvent) => {
    events.push(event);
    internals.emit?.(event);
  };

  const runtimeInternals = {
    config: internals.config,
    emit,
    save: (state: Parameters<typeof createRunHandle>[0]) =>
      internals.storage.save(state),
  };

  const executeRun = async (
    run: RunHandle,
    mode: "generate" | "stream",
    options: AgentRunOptions,
  ): Promise<{
    text: string;
    streamResult?: StreamTextResult<ToolSet, never>;
  }> => {
    const prompt = resolvePrompt(options, run.state.query);
    const messages = resolveMessages(prompt, run.state);
    const baseStopWhen =
      options.stopWhen ?? definition.stopWhen ?? isLoopFinished();
    const stopWhen = async (
      state: Parameters<Extract<typeof baseStopWhen, (...args: never) => unknown>>[0],
    ) => {
      if (run.state.status === "interrupted" || run.state.status === "error") {
        return true;
      }

      if (typeof baseStopWhen === "function") {
        return baseStopWhen(state);
      }

      for (const condition of baseStopWhen) {
        if (await condition(state)) return true;
      }

      return false;
    };
    const boundTools = run.bindTools(definition.tools);

    const shared = {
      model: definition.model,
      system: definition.system,
      tools: boundTools,
      messages,
      stopWhen,
      abortSignal: options.abortSignal,
      providerOptions: options.providerOptions ?? definition.providerOptions,
      ...run.hooks({
        onStepFinish: ({ cost }) => {
          run.state.spans.push({
            id: createSpanId("llm", run.state.spans.length),
            type: "llm",
            name: definition.name,
            status: "ok",
            startedAt: new Date().toISOString(),
            durationMs: undefined,
            error: undefined,
          });
          void cost;
        },
      }),
    };

    if (mode === "generate") {
      try {
        const result = await generateText(shared);
        return { text: result.text };
      } catch (error) {
        if (run.state.status === "running") {
          run.state.status = "error";
          run.state.completedAt = new Date().toISOString();
          await run.save();
        }
        throw error;
      }
    }

    const result = streamText(shared);

    try {
      for await (const _chunk of result.textStream) {
        if (run.state.status === "interrupted") break;
      }
    } catch {
      // critical tool failures surface through run state
    }

    const text = await result.text.catch(() => "");
    return { text, streamResult: result };
  };

  const createRunForOptions = async (options: AgentRunOptions) => {
    const query = resolveQuery(options);
    const traceId = createTraceId();
    const workflow = options.workflow;

    const state = createInitialRunState({
      query,
      model: definition.model.modelId,
      agentName: definition.name,
      traceId,
      workflowName: workflow?.name,
      workflowRunId: workflow?.runId,
      sessionId: options.sessionId,
      metadata: options.metadata,
    });

    if (workflow?.runId) {
      state.runId = workflow.runId;
    }

    await internals.storage.save(state);
    return createRunHandle(state, runtimeInternals);
  };

  const buildResult = (run: RunHandle): AgentRunResult => {
    const eventSpans = spansFromEvents(events.filter((e) => e.runId === run.runId));
    const stepSpans = spansFromSteps(run.state.steps);
    const spans = mergeSpans(run.state.spans, stepSpans, eventSpans);

    run.state.spans = spans;
    void run.save();

    return {
      id: run.runId,
      status: run.state.status,
      failure: buildFailure(run),
      observe: {
        traceId: run.state.traceId,
        cost: {
          totalUsd: run.state.totalCostUsd,
          byTool: run.state.costByTool,
        },
        spans,
      },
      output: extractOutputText(run),
      text: extractOutputText(run),
    };
  };

  return {
    name: definition.name,
    tools: definition.tools,

    async generate(options) {
      events.length = 0;
      const run = await createRunForOptions(options);

      try {
        await executeRun(run, "generate", options);
      } catch {
        // run state captures execution failures
      }

      return buildResult(run);
    },

    async stream(options) {
      events.length = 0;
      const run = await createRunForOptions(options);
      const { streamResult, text } = await executeRun(run, "stream", options);
      const agentResult = buildResult(run);

      if (!streamResult) {
        throw new Error("streamText did not return a result");
      }

      return Object.assign(streamResult, {
        run: agentResult,
        text: Promise.resolve(text),
      });
    },

    async resume(runId, options = {}) {
      events.length = 0;
      const state = await internals.storage.load(runId);
      const run = createRunHandle(state, runtimeInternals);
      await resumeRun(run, async (activeRun) => {
        await executeRun(activeRun, "generate", options);
      });
      return buildResult(run);
    },
  };
}

function resolveQuery(options: AgentRunOptions): string {
  if (options.input !== undefined) return options.input;
  if (typeof options.prompt === "string") return options.prompt;
  if (Array.isArray(options.prompt)) {
    return options.prompt
      .filter((message) => message.role === "user")
      .map((message) => extractMessageText(message))
      .join("\n");
  }
  if (options.messages) {
    return options.messages
      .filter((message) => message.role === "user")
      .map((message) => extractMessageText(message))
      .join("\n");
  }

  throw new Error("Agent run requires input, prompt, or messages");
}

export function resolvePrompt(
  options: AgentRunOptions,
  fallbackQuery: string,
): string | ModelMessage[] {
  const sources = [
    options.input !== undefined,
    options.prompt !== undefined,
    options.messages !== undefined,
  ].filter(Boolean);

  if (sources.length > 1) {
    throw new Error("Provide only one of input, prompt, or messages");
  }

  if (options.input !== undefined) return options.input;
  if (options.prompt !== undefined) return options.prompt;
  if (options.messages !== undefined) return options.messages;
  return fallbackQuery;
}

function resolveMessages(
  prompt: string | ModelMessage[],
  state: RunHandle["state"],
): ModelMessage[] {
  if (state.messages.length > 0) {
    return state.messages;
  }

  if (Array.isArray(prompt)) {
    return prompt;
  }

  return [{ role: "user", content: prompt }];
}

function extractMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .map((part) => ("text" in part ? part.text : ""))
    .join("");
}

function extractOutputText(run: RunHandle): string | undefined {
  const lastAssistant = [...run.state.messages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (!lastAssistant) return undefined;

  if (typeof lastAssistant.content === "string") {
    return lastAssistant.content;
  }

  const text = lastAssistant.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  return text || undefined;
}

function buildFailure(run: RunHandle): AgentRunResult["failure"] {
  if (run.state.status !== "interrupted" && run.state.status !== "error") {
    return undefined;
  }

  const failedStep =
    run.state.failedStepIndex !== undefined
      ? run.state.steps[run.state.failedStepIndex]
      : run.state.steps.find((step) => !step.success);

  if (run.state.status === "interrupted") {
    return {
      type: "policy",
      reason: failedStep?.error?.message ?? "critical tool failure",
    };
  }

  return {
    type: "execution",
    reason: failedStep?.error?.message ?? "tool execution failed",
  };
}
