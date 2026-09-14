import type { RuntimeEvent, Span, Step } from "../lib/types";

export function createTraceId(): string {
  return `trace_${crypto.randomUUID()}`;
}

export function createSpanId(prefix: string, index: number): string {
  return `${prefix}_${index}`;
}

export function spansFromSteps(steps: Step[]): Span[] {
  return steps.map((step, index) => ({
    id: createSpanId(step.tool, index),
    type: "tool" as const,
    name: step.tool,
    status: step.success ? ("ok" as const) : ("error" as const),
    startedAt: new Date().toISOString(),
    durationMs: step.durationMs,
    error: step.error?.message,
  }));
}

export function spansFromEvents(events: RuntimeEvent[]): Span[] {
  const spans: Span[] = [];
  const open = new Map<string, number>();

  for (const event of events) {
    if (event.type === "tool:start") {
      open.set(event.tool, spans.length);
      spans.push({
        id: createSpanId(event.tool, spans.length),
        type: "tool",
        name: event.tool,
        status: "ok",
        startedAt: new Date().toISOString(),
      });
    }

    if (event.type === "tool:complete") {
      const index = open.get(event.tool);
      const span = index !== undefined ? spans[index] : spans.at(-1);
      if (span) {
        span.status = "ok";
        span.durationMs = event.durationMs;
      }
    }

    if (event.type === "tool:failure") {
      const index = open.get(event.tool);
      const span = index !== undefined ? spans[index] : spans.at(-1);
      if (span) {
        span.status = "error";
        span.durationMs = event.durationMs;
        span.error = event.error.message;
      }
    }

    if (event.type === "tool:blocked") {
      spans.push({
        id: createSpanId(event.tool, spans.length),
        type: "tool",
        name: event.tool,
        status: "blocked",
        startedAt: new Date().toISOString(),
        error: `requires ${event.requires.join(", ")}`,
      });
    }
  }

  return spans;
}

export function mergeSpans(...groups: Span[][]): Span[] {
  const seen = new Set<string>();
  const merged: Span[] = [];

  for (const group of groups) {
    for (const span of group) {
      if (seen.has(span.id)) continue;
      seen.add(span.id);
      merged.push(span);
    }
  }

  return merged;
}
