import type { AgentRunResult, RuntimeEvent } from "agentsist";
import type { ToolRunRecord } from "./tool-tracker";

const OK = "✅";
const FAIL = "❌";
const BLOCK = "🚫";

export type AgentSummary = {
  label: string;
  records: ToolRunRecord[];
  totalCostUsd: number;
  costByTool?: Record<string, number>;
  status: string;
  runId?: string;
  traceId?: string;
  reportPath?: string;
  reportExcerpt?: string;
  message?: string;
  githubRetries?: number;
  reportBlocked?: boolean;
};

export function printSection(title: string) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

export function printAgentOutcome(summary: AgentSummary) {
  console.log("\nWhat happened:\n");

  const search = summary.records.find((r) => r.tool === "webSearchTool");
  const github = summary.records.find((r) => r.tool === "githubTool");
  const report = summary.records.find((r) => r.tool === "reportTool");

  console.log(
    `webSearchTool    ${search?.status === "success" ? OK : FAIL} ${searchLabel(search)}`,
  );

  if (summary.githubRetries && summary.githubRetries > 0) {
    console.log(
      `githubTool       ${FAIL} failed → retried ${summary.githubRetries}x → critical stop`,
    );
  } else {
    console.log(
      `githubTool       ${github?.status === "success" ? OK : FAIL} ${githubLabel(github)}`,
    );
  }

  console.log(
    `reportTool       ${reportStatusIcon(report, summary)} ${reportLabel(report, summary)}`,
  );

  if (summary.message) {
    console.log(`\n${summary.message}`);
  }

  if (summary.reportExcerpt) {
    console.log(`\nReport excerpt:\n${summary.reportExcerpt}`);
  }

  console.log(`\nCost: $${summary.totalCostUsd.toFixed(4)}${costDetail(summary)}`);

  if (summary.traceId) {
    console.log(`Trace: ${summary.traceId}`);
  }

  if (summary.runId) {
    console.log(`Run state saved: ./runs/demo/${summary.runId}.json`);
  }
}

export function printComparison(a: AgentSummary, b: AgentSummary) {
  printSection("Side by side");

  console.log(`
┌────────────────────────────┬────────────────────────────┐
│ Agent A (no agentsist)     │ Agent B (with agentsist)   │
├────────────────────────────┼────────────────────────────┤
│ GitHub fails silently      │ GitHub fails → 3 retries   │
│ Agent keeps going          │ Run halted (critical)      │
│ Report with fake GitHub    │ No report written          │
│ $${a.totalCostUsd.toFixed(4).padEnd(26)}│ $${b.totalCostUsd.toFixed(4).padEnd(26)}│
│ No tool visibility         │ Full event + cost breakdown│
└────────────────────────────┴────────────────────────────┘
`);
}

export function printVideoEvent(event: RuntimeEvent) {
  switch (event.type) {
    case "tool:start":
      console.log(`  → ${event.tool}`);
      break;
    case "tool:complete":
      console.log(`  ${OK} ${event.tool} (${event.durationMs}ms)`);
      break;
    case "tool:retry":
      console.log(
        `  ↻ ${event.tool} retry ${event.attempt}/${event.max} — ${event.error.message}`,
      );
      break;
    case "tool:failure":
      console.log(`  ${FAIL} ${event.tool} — ${event.error.message}`);
      break;
    case "tool:blocked":
      console.log(
        `  ${BLOCK} ${event.tool} blocked — requires ${event.requires.join(", ")}`,
      );
      break;
    case "run:abort":
      console.log(`  ■ Run aborted (${event.reason})`);
      break;
    case "run:complete":
      console.log(`  ■ Run completed ($${event.summary.totalCostUsd.toFixed(4)})`);
      break;
  }
}

function searchLabel(record?: ToolRunRecord) {
  if (record?.status === "success") return "found companies";
  return record?.error ?? "not called";
}

function githubLabel(record?: ToolRunRecord) {
  if (record?.status === "success") return "fetched repos";
  if (record?.status === "failure") return "failed silently";
  return "not called";
}

function reportStatusIcon(record?: ToolRunRecord, summary?: AgentSummary) {
  if (record?.status === "success") return OK;
  if (record?.status === "blocked" || summary?.reportBlocked) return BLOCK;
  return FAIL;
}

function reportLabel(record?: ToolRunRecord, summary?: AgentSummary) {
  if (record?.status === "success") return "wrote report";
  if (record?.status === "blocked" || summary?.reportBlocked) {
    return "blocked (requires githubTool)";
  }
  if (summary?.status === "interrupted" || summary?.status === "error") {
    return "not written (run stopped)";
  }
  return "not called";
}

function costDetail(summary: AgentSummary) {
  if (!summary.costByTool || Object.keys(summary.costByTool).length === 0) {
    return ", no visibility";
  }

  const parts = Object.entries(summary.costByTool)
    .filter(([, cost]) => cost > 0)
    .map(([tool, cost]) => `${tool}: $${cost.toFixed(4)}`);

  return parts.length > 0 ? `, breakdown: ${parts.join(", ")}` : ", full breakdown by tool";
}

export function collectGithubRetries(events: RuntimeEvent[]) {
  return events.filter(
    (e) => e.type === "tool:retry" && e.tool === "githubTool",
  ).length;
}

export function buildRecordsFromEvents(events: RuntimeEvent[]): ToolRunRecord[] {
  const order = ["webSearchTool", "githubTool", "reportTool"];
  const byTool = new Map<string, ToolRunRecord>();

  for (const event of events) {
    if (event.type === "tool:complete") {
      byTool.set(event.tool, { tool: event.tool, status: "success" });
    }
    if (event.type === "tool:failure") {
      byTool.set(event.tool, {
        tool: event.tool,
        status: "failure",
        error: event.error.message,
      });
    }
    if (event.type === "tool:blocked") {
      byTool.set(event.tool, {
        tool: event.tool,
        status: "blocked",
        error: `requires ${event.requires.join(", ")}`,
      });
    }
  }

  return order
    .filter((name) => byTool.has(name))
    .map((name) => byTool.get(name)!);
}

export function buildRecordsFromSpans(result: AgentRunResult): ToolRunRecord[] {
  const order = ["webSearchTool", "githubTool", "reportTool"];
  const records: ToolRunRecord[] = [];

  for (const name of order) {
    const span = result.observe.spans.find((item) => item.name === name);
    if (!span) continue;

    records.push({
      tool: name,
      status:
        span.status === "ok"
          ? "success"
          : span.status === "blocked"
            ? "blocked"
            : "failure",
      error: span.error,
    });
  }

  return records;
}

export function summaryFromAgentResult(
  label: string,
  result: AgentRunResult,
  events: RuntimeEvent[],
  options?: { reportPath?: string },
): AgentSummary {
  const records = buildRecordsFromSpans(result);
  const githubRetries = collectGithubRetries(events);
  const githubFailed = records.some(
    (record) => record.tool === "githubTool" && record.status === "failure",
  );
  const reportWritten = records.some(
    (record) => record.tool === "reportTool" && record.status === "success",
  );
  const reportBlocked = records.some(
    (record) => record.tool === "reportTool" && record.status === "blocked",
  );

  let message: string | undefined;
  if (githubFailed && !reportWritten) {
    message = [
      "githubTool failed after 3 attempts.",
      "Run stopped to prevent hallucination.",
      `Replay when GitHub is available: bun demo.ts --replay ${result.id}`,
    ].join("\n");
  }

  return {
    label,
    records,
    totalCostUsd: result.observe.cost.totalUsd,
    costByTool: result.observe.cost.byTool,
    status: result.status,
    runId: result.id,
    traceId: result.observe.traceId,
    reportPath: reportWritten ? options?.reportPath : undefined,
    githubRetries: githubFailed ? 3 : githubRetries,
    reportBlocked,
    message,
  };
}
