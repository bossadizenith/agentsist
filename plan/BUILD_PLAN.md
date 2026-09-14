# agentsist Build Plan

> **Thesis:** Detect → Decide → Recover — a control loop for agent reliability, not smarter prompts.
>
> **Public story (v0.x):** Stop agents from continuing after critical tool failures — with retry, checkpoint, replay, and built-in observability.
>
> **North star:** The reliability runtime for agents built on the Vercel AI SDK.

---

## ⚡ 20-day YC sprint (active — supersedes phase timelines below)

**Deadline:** YC application + **5–10 customers** (design partners count if they're real teams using it in production or pilot).

**What YC actually needs to see:**


| Signal   | Minimum bar in 20 days                                      |
| -------- | ----------------------------------------------------------- |
| Problem  | Demo A vs B — agent hallucinates past failed tools today    |
| Solution | `critical: true` + retry + stop + replay works on AI SDK v6 |
| Traction | 5–10 teams who integrated it (not 5–10 GitHub stars)        |
| Insight  | Manifesto + pain-point.md — you lived this building agents  |


**What you do NOT need by application day:**

- Dashboard, ingest API, ClickHouse, policy DSL, invariants, `wrap(ai)`
- 10k runs/day, hosted control plane, compensation, human-in-the-loop
- Full `runtime.agent()` — nice but not required if integration is copy-pasteable

**What counts as a customer for YC:**

- A team running agents in prod or a serious pilot
- They added agentsist to at least one agent workflow
- You can name them, show a quote or LOI, and describe the failure you prevented

Free design partners are fine. One paying pilot is a bonus, not required in 20 days.

---

### Week 1 (Days 1–7) — Ship the wedge


| Day | Build                                                                   | Sell prep                                                                     |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1–2 | `requires` on tools + middleware tests + fix rough edges                | Record 2-min demo video (A vs B, live)                                        |
| 3–4 | Slim API: `runtime.agent()` OR polished quickstart (pick one, ship one) | Landing page: one sentence + demo GIF + `npm i agentsist`                     |
| 5   | Publish `agentsist@0.2.0` to npm                                        | List 30 teams building AI SDK agents (YC cos, Twitter, Discord, your network) |
| 6–7 | README = honest wedge only; 5-min integration guide                     | Start outreach — goal: 10 calls booked                                        |


**Week 1 exit:** npm package, demo video, landing page, integration in <15 lines.

---

### Week 2 (Days 8–14) — Get 5 integrations


| Day   | Build                                                 | Sell                                                              |
| ----- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| 8–10  | Fix whatever breaks in first 2 integrations           | Onboard design partners 1–3 (white-glove, pair on their codebase) |
| 11–12 | `agent.resume(runId)` documented + one replay example | Onboard 4–5                                                       |
| 13–14 | Per-run cost + tool events in README (no dashboard)   | Onboard 6–10; collect 1-line quotes                               |


**Week 2 exit:** 5+ teams using it. Slack/Discord with them. Know their exact failure mode.

---

### Week 3 (Days 15–20) — Application


| Day   | Build                                      | Apply                                                       |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| 15–16 | Only bugs from customers — no new features | Draft application (problem, insight, traction)              |
| 17    | Case study: 1 customer before/after        | Record founder video                                        |
| 18–19 | Polish demo for interview                  | Finalize customer list + metrics (# runs, # critical stops) |
| 20    | Buffer / ship one customer-requested fix   | Submit                                                      |


**Week 3 exit:** Application live. 5–10 named customers. Metrics: runs protected, failures caught.

---

### 20-day build scope (only these)

```
✅ retry + critical + run gate + requires
✅ checkpoint/replay (current file store is fine for pilots)
✅ events + cost on run (JSON is fine — no dashboard)
✅ examples/101 demo + npm + README + 5-min quickstart
✅ Default stopWhen documented or baked

❌ defer everything in Phase 2–6 below until after YC
```

---

### Pitch one-liner (use everywhere)

> "Agents fail silently — tools error, the model keeps going, users get confident wrong answers. agentsist stops the run when critical tools fail, retries what should retry, and saves state so you can replay. Two lines on AI SDK."

---

### Risk if you build the full plan first

20 days on invariants + storage + dashboard = 0 customers. YC funds teams with **traction and clarity**, not architecture.

**Rule for the sprint:** If a task doesn't help the demo, npm install, or customer #6 — skip it.

---

## Post-YC backlog (phases below — not the sprint)

The phased roadmap below is the **product after traction**, not the 20-day path.

---

## Current state (v0.1.0)

### What works

- Tool middleware: `retry`, `critical`, `withRunGate` (block tools after abort)
- Structured events: `tool:start`, `tool:complete`, `tool:failure`, `tool:retry`, `run:abort`, `run:complete`
- Run state persistence (built-in storage — checkpoints, replay)
- Replay (`replayRun` loads transcript, re-executes agent function)
- Per-step cost tracking (`applyStepUsage`, `calculateCost`)
- Demo: `examples/101` — Agent A (plain SDK) vs Agent B (agentsist)

### What's fragile

- 7 unit tests only — no middleware integration tests
- Ceremony-heavy API: `createRuntime` → `tools` → `createRun` → `bindTools` → `hooks` → `streamText`
- Replay re-runs the whole agent function (does not skip completed tools)
- Observability is events + JSON files, not a queryable trace model
- No `requires`, invariants, or policy DSL
- `streamText` default `stepCountIs(1)` footgun — demo must set `stopWhen: isLoopFinished()` manually

### Layer map


| Layer                       | Status                              |
| --------------------------- | ----------------------------------- |
| Execute (AI SDK loop)       | User-owned today                    |
| Detect — infrastructure     | Partial (tool errors)               |
| Detect — intent             | Not built                           |
| Decide — policies           | `retry` + `critical` only           |
| Recover — checkpoint/replay | Partial (built-in store, local dev) |
| Observe — traces/cost       | Partial (run state)                 |


---

## API decisions (lock before coding)

### Runtime bootstrap

```ts
const runtime = agentsist({
  project?: string,
  environment?: string,
  // storage is built-in — runs, checkpoints, traces; not pluggable
  observe?: ObserveConfig,     // built-in; no-op without apiKey
  policies?: GlobalPolicy[],    // optional defaults for all agents
  onRunEvent?: (event) => void,
});
```

### Agent definition

```ts
const agent = runtime.agent({
  name: string,
  model: LanguageModel,
  system?: string,             // agent instructions (not per-call by default)

  tools: ToolRegistry,         // see ToolPolicy below
  stopWhen?: StopCondition,    // default: isLoopFinished() for tool agents
  output?: Output,             // optional structured output (AI SDK Output.object)

  invariants?: Invariant[],    // phase 3+
});
```

### Tool policy (extend current shape)

```ts
{
  tool: Tool,
  retry?: number | { maxRetries, delayMs },
  critical?: boolean,
  requires?: string[],        // phase 2 — upstream tools must succeed first
}
```

### Run options (passthrough + sugar)

```ts
type AgentRunOptions =
  | { input: string }                          // sugar → prompt
  | { prompt: string | ModelMessage[] }
  | { messages: ModelMessage[] }
  & {
      workflow?: { name: string; runId: string },
      sessionId?: string,
      customer?: { id: string; name?: string },
      metadata?: Record<string, string>,

      // AI SDK escape hatches (per call)
      stopWhen?: StopCondition,
      abortSignal?: AbortSignal,
    };
```

**Rules:**

- `input` OR `prompt` OR `messages` — never more than one (mirror AI SDK)
- `system` on agent definition; override per call only if needed later
- `workflow.name` + `workflow.runId` go together (group traces in observe)
- Default `stopWhen` on agent: `isLoopFinished()` — not `stepCountIs(1)`

### Run result

```ts
type AgentRunResult = {
  id: string,
  status: "running" | "completed" | "error" | "interrupted",
  failure?: { type: "execution" | "intent" | "policy"; reason: string },

  observe: {
    traceId: string,
    cost: { totalUsd: number; byTool: Record<string, number> },
    spans: Span[],
  },

  output?: unknown,            // text or structured output
};
```

### Execution modes

```ts
await agent.generate(options);  // batch — cron, API, demo scripts
await agent.stream(options);    // streaming — chat UI
await agent.resume(runId);      // recover from checkpoint
```

---

## Architecture layers (do not mix)

```
┌─────────────────────────────────────────┐
│  AI SDK loop (streamText / generateText) │
│  stopWhen, tools, output                 │
├─────────────────────────────────────────┤
│  Reliability middleware (tools)          │
│  retry, critical, requires, run gate     │
├─────────────────────────────────────────┤
│  Observe (steps + tools)                 │
│  spans, cost, traceId → built-in store   │
├─────────────────────────────────────────┤
│  Built-in storage                        │
│  runs, checkpoints, traces (same backend)  │
└─────────────────────────────────────────┘
```

- **Reliability** changes behavior (retry, abort, block).
- **Observe** records what happened (never throws, fire-and-forget flush).
- **Storage** is built-in — developers do not configure backends; runs/checkpoints/traces share one system.
- **AI SDK** owns the model loop.

---

## Phases

### Phase 1 — Trustworthy wedge (post-YC: ~1–2 weeks)

**Goal:** Collapse API; harden critical path; refactor `examples/101`.


| #   | Task                                                                         | Done when                                                         |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1.1 | Middleware integration tests (retry, critical, run gate, state save)         | `bun test` covers happy + abort paths                             |
| 1.2 | `runtime.agent()` hides `createRun` + `bindTools` + `hooks`                  | Agent B is `agent.generate({ prompt })`                           |
| 1.3 | Default `stopWhen: isLoopFinished()` on tool agents                          | Demo does not pass `stopWhen` manually                            |
| 1.4 | `requires: string[]` on tool policy                                          | `reportTool` blocked if `githubTool` never succeeded              |
| 1.5 | Span-shaped events on run state (`traceId`, `workflowRunId`, per-tool spans) | Built-in store has observe block per run                          |
| 1.6 | Refactor `examples/101` to new API                                           | Delete `agent-managed.ts` ceremony; demo still tells A vs B story |
| 1.7 | Honest README — wedge story, not full manifesto                              | README matches v0.1 capabilities                                  |


**Phase 1 exit criteria:**

```ts
const run = await researchAgent.generate({
  prompt: DEMO_TASK,
  workflow: { name: "101-demo", runId: crypto.randomUUID() },
});
// run.status === "interrupted"
// reportTool never runs
// run.observe.traceId defined
```

---

### Phase 2 — Decide layer (target: 2–4 weeks)

**Goal:** Policies in code, not prompts.


| #   | Task                                                                      |
| --- | ------------------------------------------------------------------------- |
| 2.1 | Policy types: `when` + `then` (start with `toolFailure`, `timeout`)       |
| 2.2 | `then` actions: `retry(n)`, `abort()`, `escalate()` (stub)                |
| 2.3 | Per-tool policies compose with global runtime policies                    |
| 2.4 | Policy events on observe stream (`policy:decision`)                       |
| 2.5 | Migrate demo from `critical: true` to explicit policies (backward compat) |


---

### Phase 3 — Detect intent (target: 4–6 weeks)

**Goal:** Catch semantic failures, not just HTTP errors.


| #   | Task                                                               |
| --- | ------------------------------------------------------------------ |
| 3.1 | `invariant(name, fn)` on agent definition                          |
| 3.2 | Invariant context: tool results, pending tool call, output draft   |
| 3.3 | Block or abort on invariant violation                              |
| 3.4 | Failure typing: `execution` vs `intent` on run result              |
| 3.5 | Demo invariant: report cannot ship without successful `githubTool` |


---

### Phase 4 — Recover for real (target: 6–10 weeks)

**Goal:** Resume safely, not restart blindly.


| #   | Task                                                                     |
| --- | ------------------------------------------------------------------------ |
| 4.1 | Smart resume — skip completed tool steps on replay                       |
| 4.2 | Document idempotency requirements for replay-safe tools                  |
| 4.3 | `agent.resume(runId)` first-class API                                    |
| 4.4 | Compensation hooks: `onFailure: { tool: [notify, escalate] }` (stubs OK) |
| 4.5 | Demo: GitHub back → replay resumes at GitHub, not web search             |


---

### Phase 5 — Observe + storage at scale (target: parallel with 2–4)

**Goal:** Built-in observability and persistence — one backend for runs, checkpoints, and traces.


| #   | Task                                                                               |
| --- | ---------------------------------------------------------------------------------- |
| 5.1 | Trace model: trace → spans (llm, tool), align with manifesto data model            |
| 5.2 | Unified built-in store (runs + spans + checkpoints — not user-configurable)        |
| 5.3 | Ingest pipeline (batch flush; local dev + hosted/self-hosted deploy of same stack) |
| 5.4 | Cost at ingest (per span, per model pricing table)                                 |
| 5.5 | CLI: `agentsist runs list`, `runs inspect`, `runs resume`                          |
| 5.6 | Dashboard — traces, workflows, agents, cost (same store)                           |


---

### Phase 6 — Platform (target: 10+ weeks)


| #   | Task                                                             |
| --- | ---------------------------------------------------------------- |
| 6.1 | `wrap(ai)` optional path for users who want raw SDK + middleware |
| 6.2 | Multi-agent workflows (shared `workflow.runId`)                  |
| 6.3 | Human-in-the-loop: `pause` / `approve` / `resume`                |
| 6.4 | Scale built-in store + workers for retry/resume at 10k+ runs/day |


---

## Tomorrow (Day 1) checklist — YC sprint

- [ ] `middleware.test.ts` — retry, critical, run gate
- [ ] `requires: ["githubTool"]` on reportTool in demo
- [ ] Record demo video (don't wait for perfect API)
- [ ] Draft outreach list (30 teams)
- [ ] **Do not start:** dashboard, policy DSL, invariants, storage redesign

---

## Demo contract (must always pass)


|               | Agent A (no agentsist) | Agent B (agentsist)   |
| ------------- | ---------------------- | --------------------- |
| webSearchTool | ✅ live Tavily          | ✅ live Tavily         |
| githubTool    | ❌ fails after search   | ❌ retry → abort       |
| reportTool    | ✅ may hallucinate      | 🚫 blocked            |
| Observability | none                   | trace + cost on run   |
| Recovery      | none                   | `agent.resume(runId)` |


GitHub break: `armGithubFailure()` in `search.ts` after successful search. Reset with `disarmGithubFailure()` between A and B runs.

---

## AI SDK constraints (v6)

- Use `generateText` / `streamText` + `Output.object({ schema })` — **not** `generateObject` (deprecated)
- `prompt` XOR `messages` — passthrough to AI SDK
- `ToolLoopAgent.generate()` → `generateText`; `.stream()` → `streamText`
- `streamText` alone defaults `stopWhen: stepCountIs(1)` — agentsist agent must override
- `isLoopFinished()` = loop until model stops calling tools

---

## File structure targets

### `packages/core` (after Phase 1)

```
packages/core/src/
├── index.ts
├── agent.ts              # runtime.agent(), generate/stream/resume
├── run.ts                # RunHandle (internal or slim public API)
├── middleware.ts
├── replay.ts
├── storage/              # built-in — runs, checkpoints, traces (not pluggable)
│   ├── index.ts
│   └── local.ts          # dev default; same API as hosted backend
├── observe/
│   ├── spans.ts
│   └── flush.ts
└── lib/
    ├── types.ts
    ├── usage.ts
    └── cost.ts
```

### `examples/101` (after Phase 1)

```
examples/101/
├── demo.ts
├── index.ts
├── agents/
│   └── research-agent.ts
├── tools/
│   ├── search.ts
│   ├── github.ts
│   ├── report.ts
│   └── demo-state.ts
└── lib/
    └── const.ts
```

**Remove after refactor:** `agent-managed.ts`, `agent-plain.ts` (inline A in demo), `agent.ts`, `format-demo.ts` (slim down), `tool-tracker.ts`, `tools/index.ts`, `lib/runtime/instance.ts`.

---

## Success metrics


| Milestone | Metric                                                            |
| --------- | ----------------------------------------------------------------- |
| Phase 1   | Demo B is <20 lines; 20+ tests; README honest                     |
| Phase 2   | 3+ policy types in code; no prompt-based failure handling in demo |
| Phase 3   | 1+ invariant blocks intent failure Agent A would have allowed     |
| Phase 4   | Replay demo skips completed web search step                       |
| Phase 5   | Trace queryable by `traceId`; cost by tool in CLI                 |
| Phase 6   | Documented path to 10k runs/day (built-in store + workers)        |


---

## References

- Manifesto: `reports/agent-a-report.md` (vision — do not oversell in README)
- Pain points solved: `examples/101/pain-point.md`
- Live demo: `bun run example:101:demo`
- AI SDK agent pattern: `ToolLoopAgent` in `ai` package

---

*Last updated: 2026-06-28 — added 20-day YC sprint*