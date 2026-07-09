---
title: 'Example 31: HITL Park-and-Correlate'
description: 'The Dispatcher parks a support flow at a human gate, captures checkpoint state, and resumes from the parked cursor after an operator response.'
seeAlso:
  - text: 'Guide: HITL Park-and-Correlate'
    link: '../guide/hitl'
    description: 'design rationale, parked result fields, and resume lifecycle'
  - text: 'The Dispatcher'
    link: './the-dispatcher'
    description: 'in-browser runnable support escalation demo'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
    description: 'checkpoint capture and restore APIs'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 31: HITL Park-and-Correlate

## What It Is

HITL Park-and-Correlate lets an application pause a DAG at a human boundary and resume later with a correlated response. The Dispatcher parks a support flow at `park-for-operator`, captures checkpoint state, and resumes from the parked cursor after the operator answers.

The DAG owns the pause point. The application owns persistence, correlation, and the UI or transport that collects the external response.

## How It Works

The parking node writes a correlation key, routes to `parked`, and leaves the state lifecycle at `awaiting-input`. The caller captures a checkpoint from `result.parked`, persists it under the correlation key, and later restores the state. On resume, the same placement runs again; this time the operator response is already on state, so the node routes `ready` and the DAG continues to `send-response`.

This is not a callback hidden in a node. The parked result contains the cursor and correlation key the host needs to persist the pause and re-enter the graph.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The graph shows the parked placement and resume path. [The Dispatcher](./the-dispatcher) is the in-browser owner for this principle: routine messages complete automatically, while escalations park at `park-for-operator` until the operator supplies a response.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher HITL DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

A human-in-the-loop support flow that parks mid-execution and resumes after an
operator response.

- The engine transitions the lifecycle to `awaiting-input` (non-terminal).
- `result.parked` carries the `correlationKey`, `cursor`, and `dagName`.
- `Checkpoint.capture()` works identically on a parked result (`cursor` is set).
- `dispatcher.resume()` re-enters at the parked placement with the operator response applied.

### Run

```bash
npm run docs:dev
```

Open [The Dispatcher](./the-dispatcher), enable **HUMAN GATE**, send a customer message, then answer it in the Operator pane.

## What It Lets You Do

HITL Park-and-Correlate lets a DAG pause for an external actor without turning the workflow into callback code. Use it when a customer, operator, approval queue, or compliance system must answer before the DAG can continue.

The engine returns a parked result with a correlation key and cursor; the application stores that record and resumes when the external response arrives.

### Key concepts

| Concept | Code |
|---------|------|
| Write correlationKey | `state.setMetadata('correlationKey', key)` |
| Route to park | `return RoutedBatch.create('parked', Batch.from(parked))` |
| Detect parked result | `result.parked !== null` |
| Extract cursor | `result.parked.cursor` |
| Capture checkpoint | `Checkpoint.capture('urn:noocodec:dag:hitl', result)` |
| Resume with response | `dispatcher.resume(dagName, state, cursor)` |

See [HITL Park-and-Correlate guide](../guide/hitl) for the full design rationale and
API reference.

## Code Samples

The browser run trigger starts the support DAG and captures parked results:

<<< @/../docs/.vitepress/theme/components/DispatcherRunner.vue#dispatcher-browser-run

The browser resume trigger restores the checkpoint, writes the operator response, and resumes from the parked cursor:

<<< @/../docs/.vitepress/theme/components/DispatcherRunner.vue#dispatcher-browser-resume

The DAG definition contains the parking placement and the ready path:

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

## Details for Nerds

### Flow summary

```
classify-message → park-for-operator ──parked──▶ [awaiting-input]
                                  ◀──resume──── (operator sets response)
                                  ──ready──────▶ send-response → end
```

- A node routes to the reserved `'parked'` output to pause execution.
- `result.parked` carries `dagName`, `cursor`, and `correlationKey`.
- The checkpoint captures the parked state so a later process can restore and resume.
- The same parking placement runs on resume; state determines whether it parks again or routes `ready`.

## Related Concepts

- [Guide: HITL Park-and-Correlate](../guide/hitl) - design rationale, parked result fields, and resume lifecycle
- [The Dispatcher](./the-dispatcher) - in-browser runnable support escalation demo
- [Reference: Checkpoint](../reference/checkpoint) - checkpoint capture and restore APIs
