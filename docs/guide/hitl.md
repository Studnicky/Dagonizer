---
title: 'HITL Park-and-Correlate'
description: 'Design human-in-the-loop flows that park with a correlation key, capture checkpoints, and resume from the parked cursor when an external decision arrives.'
seeAlso:
  - text: 'Example 31: HITL Park-and-Correlate'
    link: '../examples/31-hitl'
    description: 'Dispatcher browser demo showing execute, park, checkpoint, and resume'
  - text: 'The Dispatcher'
    link: '../examples/the-dispatcher'
    description: 'in-browser runnable support escalation flow'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
    description: 'checkpoint capture and restore APIs'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# HITL Park-and-Correlate

## What It Is

Human-in-the-loop flows need to pause execution, free the worker, and resume later when an external decision arrives. Dagonizer models that as park-and-correlate: a node routes to the reserved `parked` output, the result carries a correlation key and cursor, and the host persists a checkpoint until a webhook, operator action, or approval response arrives.

This is not engine suspension. It is a controlled early exit with enough state to resume the same DAG from the parked placement.

## How It Works

A parking node writes correlation metadata and routes to the reserved parked output. The dispatcher returns an `ExecutionResult` with `parked` details and a checkpointable cursor. The caller persists the checkpoint, waits for the external decision, restores state, writes the response, and calls `resume` at the parked cursor.

### Full lifecycle

```ts
// 1. Initial execute — parks at urn:noocodec:dag:support-dispatcher/node/park-for-operator
const supportDispatcherDagIri = 'urn:noocodec:dag:support-dispatcher';
const firstResult = await dispatcher.execute(supportDispatcherDagIri, initialState);
// firstResult.state.lifecycle.variant === 'awaiting-input'
// firstResult.parked.correlationKey  starts with 'escalation:'
// firstResult.parked.cursor          === 'urn:noocodec:dag:support-dispatcher/node/park-for-operator'

// 2. Capture checkpoint (persist: DB, queue, etc.)
const ckpt = await Checkpoint.capture(supportDispatcherDagIri, firstResult);
await db.save(firstResult.parked.correlationKey, ckpt.toJson());

// --- Operator writes the response out of band ---

// 3. On webhook/callback: restore and apply decision
const raw = await db.load(correlationKey);
const recalled = Checkpoint.load(JSON.parse(raw));
const { state, dagName, cursor } = recalled.restoreState(
  CheckpointRestoreAdapter.wrap(() => new MyState()),
);
state.response = 'I can help with that order.'; // inject the operator response

// 4. Resume — re-enters at the parked placement
const finalResult = await dispatcher.resume(dagName, state, cursor);
// finalResult.state.lifecycle.variant === 'completed'
// finalResult.parked                  === null
```

### Lifecycle state

The `'awaiting-input'` lifecycle variant is **not terminal**. `isTerminal()`
returns `false` for it; `isParked()` returns `true`. The scheduler resets
the lifecycle on `resume()` before calling `markRunning()`, exactly as it does
for crash-recovery resumes from terminal states.

The `correlationKey` field on the lifecycle state (`state.lifecycle.correlationKey`)
reflects the key stored in the `awaiting-input` state object. It is `null` on
all other variants.

## Diagrams, Examples, and Outputs

The Dispatcher demo contains the support escalation flow that parks for an operator response, persists a checkpoint, and resumes once the simulated operator decision is written back into state.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher HITL DAG" aria-label="Support dispatcher HITL JSON-LD DAG beside Mermaid generated from it." />

- [Example 31: HITL Park-and-Correlate](../examples/31-hitl) - Dispatcher browser demo showing execute, park, checkpoint, and resume
- [The Dispatcher](../examples/the-dispatcher) - in-browser runnable support escalation flow
- [Reference: Checkpoint](../reference/checkpoint) - checkpoint capture and restore APIs

## What It Lets You Do

### Use when

Use HITL park-and-correlate when a DAG must wait for an external actor: an operator, reviewer, customer, approval system, webhook, or compliance gate. The engine should free the worker, return a parked result, and resume later from a correlation key and cursor.

## Code Samples

The snippets below show the parking node, the support dispatcher topology, and the checkpoint/resume lifecycle around a parked cursor.

## Details for Nerds

### Design: park-and-correlate vs. engine-suspend

The primitive does **not** suspend the engine. Node processes, workers, and
containers remain free; the flow simply terminates early with a well-defined
exit state. The caller persists the checkpoint and re-invokes when the decision
arrives. This matches how serverless and queue-based architectures work: a
function call parks, stores its state in a database, and resumes when a new
invocation arrives.

The three artifacts the engine surfaces on a parked result:

| Field | Type | Meaning |
|-------|------|---------|
| `result.parked.correlationKey` | `string` | Opaque key set by the node in state metadata; use it to correlate a webhook/callback with the parked run |
| `result.parked.cursor` | `string` | Placement IRI to pass to `dispatcher.resume()` |
| `result.parked.dagName` | `string` | DAG IRI/CURIE string to pass to `dispatcher.resume()` |
| `result.cursor` | `string \| null` | Same as `parked.cursor`; present for `Checkpoint.capture()` |
| `result.state.lifecycle.variant` | `'awaiting-input'` | Non-terminal lifecycle variant; the run can resume |

### Authoring a parking node

A node parks by:

1. Writing a `correlationKey` to state metadata before routing.
2. Routing to the reserved `'parked'` output.

The engine intercepts the `'parked'` output before normal downstream execution
continues. [The Dispatcher](../examples/the-dispatcher) is the canonical runnable
example: `ParkForOperatorNode` parks the support flow when no operator response
exists, then routes `'ready'` after the restored state contains the human reply.

<<< @/../examples/the-dispatcher/nodes/ParkForOperatorNode.ts

The DAG placement still declares the escalation branch as normal topology. The
important part is that the parking node's output union includes `'parked'`; when
that output appears, the engine surfaces `result.parked` with the correlation key
and cursor.

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

### The ParkedType entity

```ts
type ParkedType = {
  correlationKey: string;  // opaque, set by the node
  cursor: string;          // placement IRI; pass to dispatcher.resume()
  dagName: string;         // DAG IRI/CURIE; pass to dispatcher.resume()
};
```

`result.parked` is `null` when the flow ran to a terminal without parking.
Check `result.parked !== null` before reading its fields.

### NodeStateBase helpers

`NodeStateBase` exposes two conveniences:

```ts
// Transition to awaiting-input and store the correlationKey in metadata.
// Equivalent to what ApproveNode.execute above does by hand.
state.park('approval:req-001');

// True iff lifecycle.variant === 'awaiting-input'
state.parked; // boolean
```

The engine calls `state.park(correlationKey)` automatically when it detects a
`'parked'` output, so nodes do not need to call it manually — just route to
`'parked'` and write the key to metadata.

## Related Concepts

- [Example 31: HITL Park-and-Correlate](../examples/31-hitl) - Dispatcher browser demo showing execute, park, checkpoint, and resume
- [The Dispatcher](../examples/the-dispatcher) - in-browser runnable support escalation flow
- [Reference: Checkpoint](../reference/checkpoint) - checkpoint capture and restore APIs
- [Reference: Lifecycle](../reference/lifecycle) - lifecycle states including `awaiting-input`
