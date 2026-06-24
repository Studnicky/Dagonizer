---
title: 'The Dispatcher'
description: 'A warm-handoff customer support demo built on Dagonizer: HITL park-and-correlate, checkpoint/resume, and a trolley switch that forces human routing. Runs in your browser with Ollama or a cloud provider API key.'
seeAlso:
  - text: 'The Archivist (in-browser demo)'
    link: './the-archivist'
    description: 'LLM agent orchestration on the same engine'
  - text: 'The Cartographer (in-browser demo)'
    link: './the-cartographer'
    description: 'Deterministic ETL on the same engine'
  - text: 'Example 31: HITL park-and-correlate'
    link: './31-hitl'
    description: 'The primitive this demo exercises'
  - text: 'Phase 08: Checkpoint + resume'
    link: './08-checkpoint'
    description: 'How Checkpoint.capture and resume() work'
  - text: 'HITL park-and-correlate'
    link: '../guide/hitl'
    description: 'Guide-level explanation of the park/resume protocol'
---

# The Dispatcher

The Dispatcher is a warm-handoff customer support pipeline: a customer sends a
message, a classifier routes it, and either the AI composes a reply instantly or
the flow suspends and waits for a human operator to respond. The browser runner
uses the same backend picker as The Archivist — Ollama locally, or cloud providers
(Groq, Gemini, Cerebras, Mistral, OpenRouter) with API keys. Classification and
composition both call the LLM; the trolley switch and escalation routing are
deterministic overrides on top of the LLM decision.

It runs on the same `@studnicky/dagonizer` engine as [The Archivist](./the-archivist)
and [The Cartographer](./the-cartographer). What changes is the domain primitive:
this demo exercises the **HITL park-and-correlate** lifecycle — `state.park()` →
`awaiting-input` lifecycle state → `Checkpoint.capture` → `dispatcher.resume()`.

Try it live below. Type a customer message and click **Send**. Switch to the
**Config** tab to flip the trolley switch and see how routing changes.

<ClientOnly>
  <DispatcherRunner />
</ClientOnly>

Watch the **DAG** pane while the flow executes: nodes light cyan while running,
edges flash on traversal, and skipped branches remain dim. When the flow parks,
the **Operator** tab activates automatically — type a response and click **Send
response** to checkpoint-and-resume the suspended execution.

## Branches and gates

Three exit paths, each producing a different outcome:

| Path | Trigger | Terminal branch | What happens |
|------|---------|----------------|--------------|
| Routine | LLM classifies message as `routine`; humanMode off | `ai-compose → send-response → end` | LLM composes a reply; flow completes in one execution |
| Escalated | LLM classifies as `escalate`, or humanMode on, or LLM error | `park-for-operator` parks | Flow suspends; operator tab activates; operator responds; resume continues to `send-response → end` |
| Off-topic | LLM classifies as `off-topic`, or blank message | `decline → end` | Polite refusal; flow completes immediately |

## The trolley switch

`state.humanMode = true` overrides all content classification. Every message,
regardless of its keywords, routes to the operator. This models a real-world
"all-human" mode: night shift, compliance hold, SLA escalation. The switch is a
boolean field on `DispatcherState` set externally (in the browser demo, the
toggle in the Config tab sets it before `execute()` fires).

The classifier checks the switch first:

```ts
if (state.humanMode) {
  state.escalationReason = 'Human mode active — routed to operator';
  return NodeOutputBuilder.of('escalate');
}
```

Nothing in the DAG wiring changes; only the classifier's output changes. The
same `park-for-operator` node handles both content-triggered and switch-triggered
escalations.

## Architecture

```
support-dispatcher
  phase('setup', 'pre', SetupNode)        ← stamps runId metadata; never gates

  classify-message
    → 'routine'   → ai-compose → send-response → end   (AI path)
    → 'escalate'  → park-for-operator
                       → 'parked'  [engine intercepts → lifecycle: awaiting-input]
                       → 'ready'   → send-response → end  (operator path)
    → 'off-topic' → decline → end
```

The `'parked'` output from `ParkForOperatorNode` is mapped to `'end'` in the
DAGBuilder call to satisfy TypeScript's route-exhaustiveness check, but the
engine intercepts `'parked'` before consulting the route map. That target is
never reached at runtime.

## The HITL flow in four steps

**Step 1 — execute and park:**

```ts
const state = new DispatcherState();
state.message = 'I need a refund';

const result = await dispatcher.execute('support-dispatcher', state);
// result.state.lifecycle.variant === 'awaiting-input'
// result.parked.correlationKey   === 'escalation:<ts>'
// result.parked.cursor            === 'park-for-operator'
```

**Step 2 — capture the checkpoint:**

```ts
const ckpt = await Checkpoint.capture('support-dispatcher', result);
const json  = ckpt.toJson();  // persist to any store (localStorage, DB, etc.)
```

**Step 3 — operator provides a response (out-of-band):**

The operator reads the customer message from `result.state.escalationReason`
(or the conversation) and types a response. In the browser demo this is the
text area in the Operator tab.

**Step 4 — restore and resume:**

```ts
const recalled = Checkpoint.load(JSON.parse(json));
const { state: restoredState, dagName, cursor } = recalled.restoreState(
  CheckpointRestoreAdapter.wrap((snap) => DispatcherState.restore(snap)),
);

// Inject the operator's response before resuming.
restoredState.response = 'Your refund is processing. 3–5 business days.';

const finalResult = await dispatcher.resume(dagName, restoredState, cursor);
// finalResult.state.lifecycle.variant === 'completed'
// finalResult.state.conversation       — contains customer + operator turns
```

`ParkForOperatorNode` re-enters on resume, sees `state.response.length > 0`,
and routes `'ready'`. The flow continues to `send-response`, which appends both
sides of the exchange to `state.conversation`.

## What to watch in the DAG pane

- **Routine path:** `setup → classify-message → ai-compose → send-response → end`.
  All five nodes fire; the escalation edges never flash.
- **Escalation path (first execute):** `setup → classify-message → park-for-operator`.
  The flow pauses at `park-for-operator`; the node stays active (not completed).
- **Escalation path (after resume):** `park-for-operator → send-response → end`.
  The graph resets; resume re-enters at the parked cursor and the remaining edges
  fire.
- **Off-topic path:** `setup → classify-message → decline → end`. The compose
  and park branches remain dim.

The **Trace** tab shows every lifecycle event in chronological order: `start`,
`end`, and the INFO lines the observer emits at key nodes
(`classify: escalate — ...`, `park-for-operator: parked`, etc.).

## Escalation keywords

`ClassifyMessageNode` uses a single compiled `RegExp` for the keyword scan:

```ts
const ESCALATION_KEYWORDS =
  /\b(refund|billing|account|password|charge|complaint|angry|urgent|manager|supervisor)\b/i;
```

Try any of these in the stream input to trigger the escalation path without
flipping the trolley switch.

## CLI run

```bash
npx tsx examples/32-dispatcher.ts
```

The CLI demo runs all three scenarios in sequence: routine (AI), escalated
(park → operator reply → resume), and trolley-forced (humanMode = true). Output
shows the lifecycle variant, escalation reason, correlation key, cursor, and
full conversation history after each run.

## Source files

| File | Role |
|------|------|
| `examples/the-dispatcher/DispatcherState.ts` | State class: `message`, `response`, `escalationReason`, `humanMode`, `conversation` |
| `examples/the-dispatcher/dag.ts` | `DispatcherBundleFactory.create()` — DAG + six node instances |
| `examples/the-dispatcher/nodes/ClassifyMessageNode.ts` | Keyword scan + trolley switch routing |
| `examples/the-dispatcher/nodes/AiComposeNode.ts` | Canned AI reply (no LLM in the demo) |
| `examples/the-dispatcher/nodes/ParkForOperatorNode.ts` | HITL suspension — `state.park()` on first enter, `'ready'` on resume |
| `examples/the-dispatcher/nodes/SendResponseNode.ts` | Appends customer + agent/operator turns to `state.conversation` |
| `examples/the-dispatcher/nodes/DeclineNode.ts` | Polite off-topic refusal |
| `examples/the-dispatcher/nodes/SetupNode.ts` | Pre-phase: stamps `runId` |
| `examples/32-dispatcher.ts` | CLI runner: three scenarios |
