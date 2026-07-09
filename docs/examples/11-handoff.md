---
title: 'Example 11: Operator Hand-Off'
description: 'The Dispatcher browser demo hands a parked customer support flow to an operator, captures checkpoint state, and resumes from the parked cursor.'
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

## What It Is

Operator Hand-Off is how an application parks a running DAG at a human boundary, stores the cursor and state, and resumes later when the operator supplies the missing input.

The Dispatcher browser demo is the concrete application: a customer turn parks at `park-for-operator`, the UI captures a checkpoint, and the operator pane resumes the same DAG from the parked cursor.

## How It Works

The first execution routes to a parked output and returns an `ExecutionResult` with `parked` metadata. The application persists the checkpoint and correlation key outside the DAG. A later actor restores state, writes the external response, and calls `dispatcher.resume(...)` from the recorded cursor. The parked node does not know whether the resumer is a browser operator, queue worker, or cloud handler.

The hand-off boundary is serialized execution state, not a callback. That keeps browser demos, queue workers, webhooks, and serverless continuations on the same runtime contract.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The browser-runnable hand-off is [The Dispatcher](./the-dispatcher): a customer turn runs until `park-for-operator`, the execution parks with a cursor, and the operator turn resumes the same DAG from that cursor. The low-level `DAGHandoff` queue envelope remains the distribution primitive; the in-browser demo shows the same state pass-over at the user-facing escalation boundary.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher hand-off DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

This example hands control from the customer-facing execution to an operator-facing continuation. The parked execution result carries the cursor and correlation key; the browser captures a checkpoint, restores state, writes the operator response, and resumes the DAG.

### Run

```bash
npm run docs:dev
```

Open [The Dispatcher](./the-dispatcher), enable **HUMAN GATE**, send a customer message, then answer it in the Operator pane.

## What It Lets You Do

Operator hand-off lets applications split one workflow across actors or processes while keeping the DAG as the source of truth. Use it when a customer-facing run must stop at a boundary, preserve state and cursor, then resume from an operator, queue worker, webhook handler, or serverless continuation.

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

This is the browser equivalent of a serverless handler resuming work from a queue envelope: serialized state plus a cursor is the hand-off boundary.

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

<<< @/../docs/.vitepress/theme/components/DispatcherRunner.vue#dispatcher-browser-resume

See [Distribution and Cloud](../guide/distribution) for the serverless handler pattern, Step Functions wiring, and idempotency guidance.

## Details for Nerds

- **Parked result hand-off.** `result.parked` is the hand-off record between the customer turn and the operator turn.
- **Snapshot fidelity.** `Checkpoint.capture` stores the state shape needed to resume after UI or process interruption.
- **Cursor resume.** `dispatcher.resume(dagName, state, cursor)` re-enters at `park-for-operator`.
- **Domain ownership.** The operator writes `state.response`; the DAG routes `ready` and sends the response.

## Related Concepts

- [Guide: Distribution and Cloud](../guide/distribution) - serverless handler pattern, Step Functions wiring, registryVersion handshake
- [Example 12: Worker Containers](./12-workers) - run a scatter-dag-body over a real WorkerThreadContainer pool
- [Reference: Entities, DAGHandoff](../reference/entities)
- [Reference: Contracts, HandoffChannelInterface](../reference/contracts)
