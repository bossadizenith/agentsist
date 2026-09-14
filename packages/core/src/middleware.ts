import type { JSONValue } from "@ai-sdk/provider";
import { tool, type Tool, type ToolExecuteFunction } from "ai";

import type {
  RunState,
  ToolMiddlewareFunction,
  ToolRetryPolicy,
  RuntimeEvent,
} from "./lib/types";
import { RunAbortedError, ToolRequiresError, serializeError } from "./errors";

type Emit = (event: RuntimeEvent) => void;

export function withToolMiddleware<INPUT, OUTPUT>(
  t: Tool<INPUT, OUTPUT>,
  middleware: ToolMiddlewareFunction<INPUT, OUTPUT>,
): Tool<INPUT, OUTPUT> {
  if (!t.execute) return t;

  const { execute, ...rest } = t;

  return tool({
    ...rest,
    execute: middleware(execute),
  });
}

function resolveRetryPolicy(retry: ToolRetryPolicy) {
  if (typeof retry === "number") {
    return { maxRetries: retry, delayMs: 300 };
  }

  return {
    maxRetries: retry.maxRetries ?? 3,
    delayMs: retry.delayMs ?? 300,
  };
}

export function withToolRequires<INPUT, OUTPUT>(
  toolName: string,
  runId: string,
  t: Tool<INPUT, OUTPUT>,
  requires: string[],
  state: RunState,
  emit: Emit,
): Tool<INPUT, OUTPUT> {
  return withToolMiddleware(t, (next) => {
    const wrapped = async (
      ...args: Parameters<ToolExecuteFunction<INPUT, OUTPUT>>
    ) => {
      const missing = requires.filter(
        (dep) => !state.steps.some((step) => step.tool === dep && step.success),
      );

      if (missing.length > 0) {
        emit({
          type: "tool:blocked",
          runId,
          tool: toolName,
          requires: missing,
        });
        throw new ToolRequiresError(toolName, missing);
      }

      return next(...args);
    };

    return wrapped as ToolExecuteFunction<INPUT, OUTPUT>;
  });
}

export function withToolEvents<INPUT, OUTPUT>(
  toolName: string,
  runId: string,
  t: Tool<INPUT, OUTPUT>,
  emit: Emit,
): Tool<INPUT, OUTPUT> {
  return withToolMiddleware(t, (next) => {
    const wrapped = async (
      ...args: Parameters<ToolExecuteFunction<INPUT, OUTPUT>>
    ) => {
      const [input] = args;
      const start = performance.now();

      emit({ type: "tool:start", runId, tool: toolName, input });

      try {
        const output = await next(...args);
        emit({
          type: "tool:complete",
          runId,
          tool: toolName,
          output,
          durationMs: Math.round(performance.now() - start),
        });
        return output;
      } catch (error) {
        emit({
          type: "tool:failure",
          runId,
          tool: toolName,
          error: serializeError(error),
          durationMs: Math.round(performance.now() - start),
        });
        throw error;
      }
    };

    return wrapped as ToolExecuteFunction<INPUT, OUTPUT>;
  });
}

export function withToolRetry<INPUT, OUTPUT>(
  toolName: string,
  runId: string,
  t: Tool<INPUT, OUTPUT>,
  retry: ToolRetryPolicy,
  emit: Emit,
): Tool<INPUT, OUTPUT> {
  const { maxRetries, delayMs } = resolveRetryPolicy(retry);

  return withToolMiddleware(t, (next) => {
    const wrapped = async (
      ...args: Parameters<ToolExecuteFunction<INPUT, OUTPUT>>
    ) => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const wait = delayMs * Math.pow(2, attempt - 1);

        try {
          return await next(...args);
        } catch (error) {
          lastError = error;
          emit({
            type: "tool:retry",
            runId,
            tool: toolName,
            attempt,
            max: maxRetries,
            error: serializeError(error),
          });

          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        }
      }

      throw lastError;
    };

    return wrapped as ToolExecuteFunction<INPUT, OUTPUT>;
  });
}

export function withRunGate<INPUT, OUTPUT>(
  t: Tool<INPUT, OUTPUT>,
  state: RunState,
): Tool<INPUT, OUTPUT> {
  return withToolMiddleware(t, (next) => {
    const wrapped = async (
      ...args: Parameters<ToolExecuteFunction<INPUT, OUTPUT>>
    ) => {
      if (state.status === "interrupted") {
        throw new RunAbortedError();
      }

      return next(...args);
    };

    return wrapped as ToolExecuteFunction<INPUT, OUTPUT>;
  });
}

export function withToolCritical<INPUT, OUTPUT>(
  toolName: string,
  runId: string,
  t: Tool<INPUT, OUTPUT>,
  abort: (reason: string, error?: unknown) => void,
  emit: Emit,
): Tool<INPUT, OUTPUT> {
  return withToolMiddleware(t, (next) => {
    const wrapped = async (
      ...args: Parameters<ToolExecuteFunction<INPUT, OUTPUT>>
    ) => {
      try {
        return await next(...args);
      } catch (error) {
        emit({
          type: "run:abort",
          runId,
          reason: "critical tool failure",
          tool: toolName,
          error: serializeError(error),
        });
        abort("critical tool failure", error);
        throw error;
      }
    };

    return wrapped as ToolExecuteFunction<INPUT, OUTPUT>;
  });
}

export function withToolStateCapture<INPUT, OUTPUT>(
  toolName: string,
  t: Tool<INPUT, OUTPUT>,
  state: RunState,
  save: () => Promise<void>,
): Tool<INPUT, OUTPUT> {
  return withToolMiddleware(t, (next) => {
    const wrapped = async (
      ...args: Parameters<ToolExecuteFunction<INPUT, OUTPUT>>
    ) => {
      const [input, call] = args;
      const start = performance.now();

      seedMessages(state, call.messages);

      try {
        const output = await next(...args);
        state.steps.push({
          toolCallId: call.toolCallId,
          tool: toolName,
          input: input as Record<string, unknown>,
          output,
          success: true,
          durationMs: Math.round(performance.now() - start),
        });
        appendToolTranscript(state, {
          toolCallId: call.toolCallId,
          toolName,
          input,
          output,
        });
        await save();
        return output;
      } catch (error) {
        const failedStepIndex = state.steps.length;
        if (state.status === "running") {
          state.status = "error";
          state.failedStepIndex = failedStepIndex;
          state.completedAt = new Date().toISOString();
        }
        state.steps.push({
          toolCallId: call.toolCallId,
          tool: toolName,
          input: input as Record<string, unknown>,
          output: null,
          success: false,
          durationMs: Math.round(performance.now() - start),
          error: serializeError(error),
        });
        await save();
        throw error;
      }
    };

    return wrapped as ToolExecuteFunction<INPUT, OUTPUT>;
  });
}

function seedMessages(
  state: RunState,
  priorMessages: RunState["messages"],
): void {
  if (state.messages.length === 0 && priorMessages.length > 0) {
    state.messages.push(...priorMessages);
  }
}

function appendToolTranscript(
  state: RunState,
  {
    toolCallId,
    toolName,
    input,
    output,
  }: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  },
): void {
  state.messages.push(
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId,
          toolName,
          input,
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId,
          toolName,
          output: toToolResultOutput(output),
        },
      ],
    },
  );
}

function toToolResultOutput(output: unknown) {
  return typeof output === "string"
    ? { type: "text" as const, value: output }
    : { type: "json" as const, value: (output ?? null) as JSONValue };
}
