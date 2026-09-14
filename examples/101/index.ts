import { createResearchAgent } from "./agents/research-agent";
import { DEMO_TASK } from "./lib/const";
import { requireDemoEnv } from "./lib/require-env";

function getReplayRunId(): string | undefined {
  const flagIndex = process.argv.indexOf("--replay");
  if (flagIndex !== -1) {
    return process.argv[flagIndex + 1];
  }

  return (
    process.env.REPLAY_RUN_ID ??
    process.argv.find((arg) => arg.startsWith("run_"))
  );
}

const main = async () => {
  requireDemoEnv();
  const replayRunId = getReplayRunId();
  const researchAgent = createResearchAgent();

  if (replayRunId) {
    const run = await researchAgent.resume(replayRunId);
    console.log(run.status, run.observe.traceId);
    return;
  }

  const run = await researchAgent.generate({
    input: DEMO_TASK,
    workflow: { name: "101-demo", runId: `run_${Date.now()}` },
  });

  console.log(JSON.stringify(run, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
