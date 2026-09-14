import type { RuntimeEvent } from "agentsist";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createResearchAgent } from "./agents/research-agent";
import {
  AGENT_A_REPORT_PATH,
  AGENT_B_REPORT_PATH,
  DEMO_TASK,
} from "./lib/const";
import {
  printAgentOutcome,
  printComparison,
  printSection,
  printVideoEvent,
  summaryFromAgentResult,
} from "./lib/format-demo";
import { runPlainAgent } from "./lib/plain-agent";
import { requireDemoEnv } from "./lib/require-env";
import { resetDemoState } from "./tools/demo-state";

function loadEnv() {
  const envPath = path.resolve(import.meta.dir, "../../.env");
  try {
    const text = readFileSync(envPath, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional when env vars are already exported
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanReports() {
  for (const file of [AGENT_A_REPORT_PATH, AGENT_B_REPORT_PATH]) {
    try {
      rmSync(file, { force: true });
    } catch {}
  }
}

async function runDemo() {
  loadEnv();
  requireDemoEnv();

  const onlyA = process.argv.includes("--only-a");
  const onlyB = process.argv.includes("--only-b");
  const videoMode = process.argv.includes("--video");

  console.log("═".repeat(60));
  console.log("  agentsist Demo: Silent Failure vs Critical Stop");
  console.log("═".repeat(60));
  console.log(`\nTask: "${DEMO_TASK}"`);
  console.log(
    "\nwebSearchTool runs live (Tavily). githubTool fails midway (armed after search).\n",
  );

  if (videoMode) {
    console.log("(video mode — compact tool output)");
    console.log("(tip: record with --only-a then --only-b to avoid rate limits)\n");
  }

  const prompt = (reportPath: string) =>
    `${DEMO_TASK}\n\nWrite the report to ${reportPath}.`;

  let agentA: Awaited<ReturnType<typeof runPlainAgent>> | undefined;
  let agentB: ReturnType<typeof summaryFromAgentResult> | undefined;

  if (!onlyB) {
    await cleanReports();
    resetDemoState();
    printSection("Agent A — no agentsist");
    agentA = await runPlainAgent(prompt(AGENT_A_REPORT_PATH));
    printAgentOutcome(agentA);
  }

  if (!onlyA) {
    if (agentA) {
      console.log("\n⏳ Pausing 65s before Agent B (Groq TPM limit)...\n");
      await sleep(65_000);
    }

    await cleanReports();
    resetDemoState();

    const events: RuntimeEvent[] = [];
    let showVideoEvents = true;
    const researchAgent = createResearchAgent({
      onEvent: (event) => {
        events.push(event);
        if (videoMode && showVideoEvents) {
          printVideoEvent(event);
        }
        if (event.type === "run:abort") {
          showVideoEvents = false;
        }
      },
    });

    printSection("Agent B — with agentsist");
    if (videoMode) {
      console.log(`  workflow: 101-demo`);
    }

    const run = await researchAgent.generate({
      prompt: prompt(AGENT_B_REPORT_PATH),
      workflow: {
        name: "101-demo",
        runId: `run_${Date.now()}`,
      },
    });

    agentB = summaryFromAgentResult(
      "Agent B (with agentsist)",
      run,
      events,
      { reportPath: AGENT_B_REPORT_PATH },
    );
    printAgentOutcome(agentB);
  }

  if (agentA && agentB) {
    printComparison(agentA, agentB);
  }
}

async function replayManaged(runId: string) {
  loadEnv();
  requireDemoEnv();

  const events: RuntimeEvent[] = [];
  const researchAgent = createResearchAgent({
    onEvent: (event) => events.push(event),
  });

  console.log(`Resuming run ${runId}...`);
  const run = await researchAgent.resume(runId);
  console.log(`Status: ${run.status}`);
  console.log(`Trace: ${run.observe.traceId}`);
  console.log(`Cost: $${run.observe.cost.totalUsd.toFixed(4)}`);
}

function getReplayRunId(): string | undefined {
  const flagIndex = process.argv.indexOf("--replay");
  if (flagIndex !== -1) {
    return process.argv[flagIndex + 1];
  }

  return process.argv.find((arg) => arg.startsWith("run_"));
}

const main = async () => {
  const replayRunId = getReplayRunId();

  if (replayRunId) {
    await replayManaged(replayRunId);
    return;
  }

  await runDemo();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
