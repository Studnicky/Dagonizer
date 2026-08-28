---
title: 'Example 11: Operator Hand-Off'
description: 'The Dispatcher support workflow parks a support case, captures checkpoint state, and resumes from the parked cursor after operator input.'
seeAlso:
  - text: 'Guide: Distribution and Cloud'
    link: '../guide/distribution'
    description: 'serverless handler pattern, Step Functions wiring, registryVersion handshake'
  - text: 'Example 12: Worker Containers'
    link: './12-workers'
    description: 'run a scatter-dag-body over a real WorkerThreadContainer pool'
  - text: 'Reference: Entities, DAGHandoff'
    link: '../reference/entities'
  - text: 'Reference: Contracts, HandoffChannelInterface'
    link: '../reference/contracts'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 11: Operator Hand-Off

## Operator Handoff Surface

Operator Hand-Off is the parked-execution boundary for human-in-the-loop work. One actor runs the DAG until it parks, persists state plus cursor, and another actor resumes from that cursor after supplying the missing input.

In The Dispatcher, a customer turn parks at `park-for-operator`, the workflow captures a checkpoint, and the operator pane restores the parked state before resuming the same DAG.

## Checkpointed Handoff Flow

### DAG registration and diagram

`supportDispatcherDAG` contains the full `park-for-operator -> ready -> send-response` path. The same boundary can cross a queue or service hop through `DAGHandoff`; the Dispatcher keeps that hand-off inside one support runtime while using the same parked-state contract.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher hand-off DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

The parked `ExecutionResult` carries the cursor and correlation key. The host persists that checkpoint, restores state, writes the operator response, and resumes from the recorded cursor.

### Run

```bash
pnpm run site:dev
```

Visit [The Dispatcher](./the-dispatcher), enable **HUMAN GATE**, send a customer message, then answer it in the Operator pane.

## Cross-actor Resume Model

The first execution routes to a parked output and returns an `ExecutionResult` with `parked` metadata. The host persists the checkpoint and correlation key outside the DAG. A later actor restores state, writes the external response, and calls `dispatcher.resume(...)` from the recorded cursor. The parked node does not know whether the resumer is a browser operator, queue worker, or cloud handler.

The hand-off boundary is serialized execution state plus cursor, not a callback. That keeps interactive hosts, queue workers, webhooks, and serverless continuations on the same runtime contract.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

### Key APIs

| Symbol | Import | Role |
|--------|--------|------|
| `Checkpoint.capture` | `@studnicky/dagonizer/checkpoint` | Captures parked state and cursor |
| `CheckpointRestoreAdapter` | `@studnicky/dagonizer/checkpoint` | Restores `DispatcherState` from the snapshot |
| `dispatcher.resume` | `@studnicky/dagonizer` | Continues from the parked cursor |
| `result.parked` | `ExecutionResultType` | Carries cursor and correlation key |

Queue-backed hand-off uses the same state snapshot/cursor idea across a transport boundary.

#### Browser resume trigger

The browser hand-off stores the parked result in memory. A distributed transport uses a `DAGHandoff` envelope and a `HandoffChannelInterface` implementation instead of the in-page operator state.

<<< @/../examples/the-dispatcher/app/DispatcherRunner.vue#dispatcher-browser-resume

See [Distribution and Cloud](../guide/distribution) for the serverless handler pattern, Step Functions wiring, and idempotency guidance.

## Operational Uses

Operator hand-off splits one workflow across customer and operator actors without duplicating the graph or rebuilding state by hand. The first execution stops at the park point; the second execution restores the parked snapshot and continues from the recorded cursor.

### Key concept

The grain of a hand-off is execution state, not a callback. The first Dispatcher call runs until the park point. The second operator action restores state from the parked result and resumes from the cursor. The parked node does not know who resumes it.

```
dispatcher.execute('urn:noocodec:dag:support-dispatcher', state)
  │
  └─ park-for-operator routes 'parked'
       │
       └─ Checkpoint.capture(...) stores state + cursor
              │
              └─ operator response → restore state → dispatcher.resume(...)
```

The same pattern works for queue workers, webhooks, or serverless continuations because the parked node does not depend on who resumes it.

## Runtime Notes

- **Parked result hand-off.** `result.parked` is the hand-off record between the customer turn and the operator turn.
- **Snapshot fidelity.** `Checkpoint.capture` stores the state shape needed to resume after UI or process interruption.
- **Cursor resume.** `dispatcher.resume(dagName, state, cursor)` re-enters at `park-for-operator`.
- **Domain ownership.** The operator writes `state.response`; the DAG routes `ready` and sends the response.

## Related Concepts

- [Guide: Distribution and Cloud](../guide/distribution) - serverless handler pattern, Step Functions wiring, registryVersion handshake
- [Example 12: Worker Containers](./12-workers) - run a scatter-dag-body over a real WorkerThreadContainer pool
- [Reference: Entities, DAGHandoff](../reference/entities)
- [Reference: Contracts, HandoffChannelInterface](../reference/contracts)
