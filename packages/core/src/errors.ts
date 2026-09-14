import type { SerializedError } from "./lib/types";

export class RunAbortedError extends Error {
  constructor() {
    super("Run aborted — no further tool calls are allowed");
    this.name = "RunAbortedError";
  }
}

export class ToolRequiresError extends Error {
  readonly tool: string;
  readonly requires: string[];

  constructor(tool: string, requires: string[]) {
    super(
      `${tool} blocked — requires successful: ${requires.join(", ")}`,
    );
    this.name = "ToolRequiresError";
    this.tool = tool;
    this.requires = requires;
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}
