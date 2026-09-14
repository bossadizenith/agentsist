import { tool, type Tool } from "ai";

export type ToolRunRecord = {
  tool: string;
  status: "success" | "failure" | "blocked";
  error?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trackTools<T extends Record<string, Tool<any, any>>>(
  tools: T,
  onRecord: (record: ToolRunRecord) => void,
): T {
  const tracked = {} as T;

  for (const [name, t] of Object.entries(tools)) {
    if (!t.execute) {
      tracked[name as keyof T] = t as T[keyof T];
      continue;
    }

    const { execute, ...rest } = t;

    tracked[name as keyof T] = tool({
      ...rest,
      execute: async (input, options) => {
        try {
          const output = await execute(input, options);
          onRecord({ tool: name, status: "success" });
          return output;
        } catch (error) {
          onRecord({
            tool: name,
            status: "failure",
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    }) as T[keyof T];
  }

  return tracked;
}
