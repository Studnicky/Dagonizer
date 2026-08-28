---
title: 'Example 28: Runner and Triggers'
description: 'The Dispatcher support runtime owns register→seed→execute/resume→project, with customer and operator triggers around the same DAG.'
seeAlso:
  - text: 'Reference: Runner'
    link: '../reference/runner'
    description: 'Full API for DagRunner and all trigger variants'
  - text: 'Reference: Contracts'
    link: '../reference/contracts'
    description: 'TriggerInterface adapter contract'
  - text: 'Example 08: Checkpoint and Resume'
    link: './08-checkpoint'
    description: 'DagRunner.resume() picks up from a checkpoint cursor'
  - text: 'Authoring DAGs'
    link: '../guide/authoring'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 28: Runner and Triggers

## Host Adapter Surface

Runner and Triggers is the host-adapter loop around a DAG: register bundles, seed state, execute or resume, then project the result back into the surrounding interface. The Dispatcher support example does this with two triggers around the same support DAG: customer send and operator resume.

Trigger handling belongs to the host; flow decisions belong to the DAG.

## Trigger and Runner References

### DAG registration and diagram

The DAG is the same for every trigger; the runner owns when it starts. [The Dispatcher](./the-dispatcher) uses customer send and operator resume as two triggers around the same registered `support-dispatcher` DAG.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher runner DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

Every host that runs a DAG from a UI button, CLI script, HTTP handler, or event loop independently derives the same loop: build a dispatcher, register bundles, seed initial state, call `execute` or `resume`, route the outcome, and project a result. The Dispatcher runtime is the support-domain version of that loop.

### Run

```bash
pnpm run site:dev
```

Visit [The Dispatcher](./the-dispatcher).

## Trigger and Projection Boundary

The runner owns host concerns: constructing the dispatcher, registering node/DAG bundles, mapping external input into state, choosing `execute` or `resume`, and projecting the final state back into UI or transport output. The DAG owns only flow decisions. Multiple triggers can therefore drive one canonical JSON-LD graph.

That same loop appears in a browser button, CLI command, HTTP handler, queue worker, cron job, or webhook. Only the trigger adapter changes.

## Code Samples

#### The support DAG

The support DAG classifies the message, composes or parks, and converges on `send-response`.

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

#### Browser run trigger

The customer **Send** button seeds `DispatcherState`, registers the live nodes and DAG, then executes `support-dispatcher`.

<<< @/../examples/the-dispatcher/app/DispatcherRunner.vue#dispatcher-browser-run

#### Browser resume trigger

The operator **Send response** button restores the parked checkpoint and resumes the same DAG from the parked cursor.

<<< @/../examples/the-dispatcher/app/DispatcherRunner.vue#dispatcher-browser-resume

### Trigger mapping

The same runner pattern applies outside the browser:

| Browser trigger | Runner equivalent |
|-----------------|-------------------|
| Customer **Send** | request/event trigger calls `run` |
| Operator **Send response** | request/event trigger calls `resume` |
| Config toggles | `seedState` input mapping |
| Conversation panel | `projectResult` view projection |

## Operational Uses

Runners let hosts separate trigger handling from DAG behavior. They fit cases where the same graph must start from a browser event, CLI command, HTTP request, queue message, or resume event while keeping registration, state seeding, execution, and projection in one host boundary.

This keeps the DAG portable. You can move a flow from a user-facing runtime surface to a service endpoint without rewriting the graph as long as the runner supplies the same bundles, state, and resume contract.

## Runtime Notes

- **Run loop ownership.** The runner host owns dispatcher construction, bundle registration, state seeding, execution, and projection.
- **Separate triggers, same DAG.** Customer send and operator resume trigger different entry actions around the same DAG document.
- **Resume path.** The runner captures and restores checkpoint state before calling `dispatcher.resume`.
- **Import path.** The reusable class-based runner API for non-browser adapters ships through `@studnicky/dagonizer/runner`.

## Related Concepts

- [Reference: Runner](../reference/runner) - Full API for DagRunner and all trigger variants
- [Reference: Contracts](../reference/contracts) - TriggerInterface adapter contract
- [Example 08: Checkpoint and Resume](./08-checkpoint) - DagRunner.resume() picks up from a checkpoint cursor
- [Authoring DAGs](../guide/authoring)
