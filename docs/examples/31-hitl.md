---
title: 'Example 31: HITL Park-and-Correlate'
description: 'The Dispatcher parks a support workflow at a human gate, captures checkpoint state, and resumes from the parked cursor after an operator response.'
seeAlso:
  - text: 'Guide: HITL Park-and-Correlate'
    link: '../guide/hitl'
    description: 'design rationale, parked result fields, and resume lifecycle'
  - text: 'The Dispatcher'
    link: './the-dispatcher'
    description: 'support workflow with operator park and resume'
  - text: 'Reference: Checkpoint'
    link: '../reference/checkpoint'
    description: 'checkpoint capture and restore APIs'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 31: HITL Park-and-Correlate

## Park-and-Resume Surface

HITL Park-and-Correlate lets a host pause a DAG at a human boundary and resume later with a correlated response. The Dispatcher parks a support workflow at `park-for-operator`, captures checkpoint state, and resumes from the parked cursor after the operator answers.

The DAG owns the pause point. The host owns persistence, correlation, and the UI or transport that collects the external response.

## Parked Support Flow

### DAG registration and diagram

The graph shows the parked placement and resume path. [The Dispatcher](./the-dispatcher) applies this principle directly: routine messages complete automatically, while escalations park at `park-for-operator` until the operator supplies a response.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher HITL DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

The support workflow parks mid-execution and resumes after an operator response.

- The engine transitions the lifecycle to `awaiting-input` (non-terminal).
- `result.parked` carries the `correlationKey`, `cursor`, and `dagName`.
- `Checkpoint.capture()` works identically on a parked result (`cursor` is set).
- `dispatcher.resume()` re-enters at the parked placement with the operator response applied.

### Run

```bash
pnpm run site:dev
```

Visit [The Dispatcher](./the-dispatcher), enable **HUMAN GATE**, send a customer message, then answer it in the Operator pane.

## Correlation and Resume Model

The parking node writes a correlation key, routes to `parked`, and leaves the state lifecycle at `awaiting-input`. The caller captures a checkpoint from `result.parked`, persists it under the correlation key, and later restores the state. On resume, the same placement runs again; this time the operator response is already on state, so the node routes `ready` and the DAG continues to `send-response`.

This is not a callback hidden in a node. The parked result contains the cursor and correlation key the host needs to persist the pause and re-enter the graph.

## Code Samples

The browser run trigger starts the support DAG and captures parked results:

<<< @/../examples/the-dispatcher/app/DispatcherRunner.vue#dispatcher-browser-run

The browser resume trigger restores the checkpoint, writes the operator response, and resumes from the parked cursor:

<<< @/../examples/the-dispatcher/app/DispatcherRunner.vue#dispatcher-browser-resume

The DAG definition contains the parking placement and the ready path:

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

## Operational Uses

HITL Park-and-Correlate lets a DAG pause for an external actor without turning the workflow into callback code. It fits cases where a customer, operator, approval queue, or compliance system must answer before the DAG can continue.

The engine returns a parked result with a correlation key and cursor; the host stores that record and resumes when the external response arrives.

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

## Runtime Notes

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
- [The Dispatcher](./the-dispatcher) - support workflow with operator park and resume
- [Reference: Checkpoint](../reference/checkpoint) - checkpoint capture and restore APIs
