---
title: 'The Dispatcher'
description: 'A warm-handoff customer support demo powered by Dagonizer: HITL Park-and-Correlate, checkpoint/resume, and a trolley switch that forces human routing. Runs in your browser with Ollama or a cloud provider API key.'
seeAlso:
  - text: 'The Archivist'
    link: './the-archivist'
    description: 'LLM agent orchestration on the same engine'
  - text: 'The Cartographer'
    link: './the-cartographer'
    description: 'Deterministic ETL on the same engine'
  - text: 'Example 31: HITL Park-and-Correlate'
    link: './31-hitl'
    description: 'The primitive this demo exercises'
  - text: 'Example 08: Checkpoint and Resume'
    link: './08-checkpoint'
    description: 'How Checkpoint.capture and resume() work'
  - text: 'HITL Park-and-Correlate'
    link: '../guide/hitl'
    description: 'Guide-level explanation of the park/resume protocol'
---

# The Dispatcher

## What It Is

The Dispatcher is a runnable demo: a real browser-executed DAG application, not a decorative diagram. It is a warm-handoff customer support demo powered by Dagonizer: HITL Park-and-Correlate, checkpoint/resume, and a trolley switch that forces human routing. It runs in your browser with Ollama or a cloud provider API key.

Use it to see human review without losing DAG state or auditability. The customer flow parks with a cursor, the operator flow resumes from that cursor, and the same graph records both halves.

## How It Works

The runner wires real node classes, real DAG documents, and browser UI observers together. The visual panes listen to dispatcher lifecycle events, so the page shows execution rather than replaying a canned animation.

### Architecture

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

## Diagrams, Examples, and Outputs

The live demo is the main diagram. Its graph, state panes, traces, backend selectors, operator panel, and outputs are all evidence from the running system.

### Branches and gates

Three exit paths, each producing a different outcome:

| Path | Trigger | Terminal branch | What happens |
|------|---------|----------------|--------------|
| Routine | Classifier (embedder or LLM) resolves `routine`; humanMode off | `ai-compose → send-response → end` | LLM composes a reply; flow completes in one execution |
| Escalated | Classifier resolves `escalate`, or humanMode on, or classification error | `park-for-operator` parks | Flow suspends; operator tab activates; operator responds; resume continues to `send-response → end` |
| Off-topic | Classifier resolves `off-topic`, or blank message | `decline → end` | Polite refusal; flow completes immediately |

In `embedder` mode (the default), the on-device embedder classifies first; the
LLM only steps in when the embedder is unavailable or its top score misses the
confidence floor. In `llm` mode, the LLM classifies every message directly.

### CLI run

```bash
npx tsx examples/32-dispatcher.ts
```

The CLI demo runs all three scenarios in sequence: routine (AI), escalated
(park → operator reply → resume), and trolley-forced (humanMode = true). Output
shows the lifecycle variant, escalation reason, correlation key, cursor, and
full conversation history after each run.

### What this proves

The Dispatcher proves HITL Park-and-Correlate in a real browser flow: a DAG can park, expose a correlation key, capture a checkpoint, wait for a human, restore state, and resume through the same JSON-LD graph.

Classification runs on-device by default: an offline MiniLM embedder computes
cosine similarity between the message and three intent anchors (`routine`,
`escalate`, `off-topic`) — instant, with no LLM round-trip and no adapter-timeout
exposure. The LLM composes the reply on the routine branch, and also serves as
the classification path when the embedder is unavailable, when it isn't
confident about a message, or when the Config toggle is set to `llm` mode. The
trolley switch and escalation routing are deterministic overrides on top of
whichever classifier decided.

It runs on the same `@studnicky/dagonizer` engine as [The Archivist](./the-archivist)
and [The Cartographer](./the-cartographer). What changes is the domain primitive:
this demo exercises the **HITL Park-and-Correlate** lifecycle — `state.park()` →
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

## What It Lets You Do

Use the Dispatcher when you want to see the awkward middle of automation: a model can help, but a person sometimes has to decide. The graph makes that handoff explicit instead of hiding it in UI state.

For application teams, this page answers the operational question: can a DAG pause, expose a correlation key, wait for an external decision, and resume without pretending the pause never happened? The demo shows the whole loop.

### What to try

Send a routine support message, then send a refund or billing escalation. Toggle **HUMAN GATE** to force the operator path, answer from the Operator tab, and watch the DAG resume from the parked cursor instead of restarting.

## Code Samples

The Dispatcher source is small enough to read in one sitting. Start with the DAG, then inspect the parking node and CLI runner that prove the checkpoint/resume path.

### Canonical support DAG

<<< ../../examples/the-dispatcher/dag.ts#dispatcher-bundle

### Park and resume node

<<< ../../examples/the-dispatcher/nodes/ParkForOperatorNode.ts

### CLI runner

<<< ../../examples/32-dispatcher.ts

### Source files

| File | Role |
|------|------|
| `examples/the-dispatcher/DispatcherState.ts` | State class: `message`, `response`, `escalationReason`, `humanMode`, `conversation` |
| `examples/the-dispatcher/dag.ts` | `supportDispatcherDAG` - canonical JSON-LD DAG |
| `examples/the-dispatcher/nodes/ClassifyMessageNode.ts` | Keyword scan + trolley switch routing |
| `examples/the-dispatcher/nodes/AiComposeNode.ts` | Canned AI reply (no LLM in the demo) |
| `examples/the-dispatcher/nodes/ParkForOperatorNode.ts` | HITL suspension — `state.park()` on first enter, `'ready'` on resume |
| `examples/the-dispatcher/nodes/SendResponseNode.ts` | Appends customer + agent/operator turns to `state.conversation` |
| `examples/the-dispatcher/nodes/DeclineNode.ts` | Polite off-topic refusal |
| `examples/the-dispatcher/nodes/SetupNode.ts` | Pre-phase: stamps `runId` |
| `examples/32-dispatcher.ts` | CLI runner: three scenarios |

## Details for Nerds

### The trolley switch

`state.humanMode = true` overrides all content classification. Every message,
regardless of its keywords, routes to the operator. This models a real-world
"all-human" mode: night shift, compliance hold, SLA escalation. The switch is a
boolean field on `DispatcherState` set externally (in the browser demo, the
toggle in the Config tab sets it before `execute()` fires).

The classifier checks the switch first:

```ts
if (item.state.humanMode) {
  item.state.escalationReason = 'Human mode active — routed to operator';
  escalated.push(item);
  continue;
}
```

Nothing in the DAG wiring changes; only the classifier's output changes. The
same `park-for-operator` node handles both content-triggered and switch-triggered
escalations.

### The classification-mode toggle

A second Config-tab control swaps `state.classificationMode` between
`'embedder'` (the default) and `'llm'`:

- `'embedder'` — the on-device MiniLM embedder computes cosine similarity
  between the message and three intent anchors. Instant, no LLM round-trip.
  When the embedder is unavailable in the session, or its top score misses the
  confidence floor, classification transparently routes to the LLM.
- `'llm'` — every message is classified generatively via the active LLM
  adapter. Slower, since each message loads/queries the model.

The toggle exists so the two strategies can be compared side by side in the
demo. The trolley switch still wins over both: `humanMode = true` forces
`escalate` regardless of `classificationMode`.

### The HITL flow in four steps

**Step 1 — execute and park:**

```ts
const state = new DispatcherState();
state.message = 'I need a refund';

const result = await dispatcher.execute('urn:noocodec:dag:support-dispatcher', state);
// result.state.lifecycle.variant === 'awaiting-input'
// result.parked.correlationKey   === 'escalation:<ts>'
// result.parked.cursor            === 'park-for-operator'
```

**Step 2 — capture the checkpoint:**

```ts
const ckpt = await Checkpoint.capture('urn:noocodec:dag:support-dispatcher', result);
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

### What to watch in the DAG pane

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

### Escalation keywords

`ClassifyMessageNode` uses a single compiled `RegExp` for the keyword scan:

```ts
const ESCALATION_KEYWORDS =
  /\b(refund|billing|account|password|charge|complaint|angry|urgent|manager|supervisor)\b/i;
```

Try any of these in the stream input to trigger the escalation path without
flipping the trolley switch.

## Related Concepts

Read these next when you want to connect the Dispatcher demo to HITL parking, checkpoint capture, resume, and handoff.

- [The Archivist](./the-archivist) - LLM agent orchestration on the same engine
- [The Cartographer](./the-cartographer) - Deterministic ETL on the same engine
- [Example 31: HITL Park-and-Correlate](./31-hitl) - The primitive this demo exercises
- [Example 08: Checkpoint and Resume](./08-checkpoint) - How Checkpoint.capture and resume() work
- [HITL Park-and-Correlate](../guide/hitl) - Guide-level explanation of the park/resume protocol

### Dispatcher Feature Map

These numbered examples are owned by the Dispatcher domain because they extend support-workflow operations around human input and external triggers:

| Example | Principle in the runnable Dispatcher |
|---------|---------------------------------------|
| [Example 11: Operator Hand-Off](./11-handoff) | Hand-off is the next transport step after `park-for-operator`: a parked or completed support case can publish a `DAGHandoff` envelope to another host. |
| [Example 21: Per-Node Timeout](./21-per-node-timeout) | Timeout belongs around `ai-compose` and operator-wait boundaries so slow automation fails without aborting unrelated support runs. |
| [Example 23: Checkpoint Store](./23-checkpoint-store) | Parked support state uses the same snapshot/store/restore path as checkpoint persistence. |
| [Example 28: Runner and Triggers](./28-runner) | Runner triggers belong here for scheduled support automation and request-triggered support flows. |
| [Example 31: HITL Park-and-Correlate](./31-hitl) | The browser demo is the high-level HITL implementation: `park-for-operator` pauses, stores a cursor, and resumes after a correlated decision. |
