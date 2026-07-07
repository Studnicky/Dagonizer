---
title: 'Example 28: Runner and Triggers'
description: 'The Dispatcher browser runner owns register→seed→execute/resume→project, with customer and operator UI triggers around the same DAG.'
seeAlso:
  - text: 'Reference: Runner'
    link: '../reference/runner'
    description: 'Full API surface for DagRunner and all trigger variants'
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

## What It Is

Runner and Triggers is the host-side loop around a DAG: register bundles, seed state, execute or resume, then project the result back into the application. The Dispatcher browser runner does this with two UI triggers around the same support DAG: customer send and operator resume.

The point is separation. Trigger handling belongs to the application host; flow decisions belong to the DAG.

## How It Works

The runner owns host concerns: constructing the dispatcher, registering node/DAG bundles, mapping external input into state, choosing `execute` or `resume`, and projecting the final state back into UI or transport output. The DAG owns only flow decisions. Multiple triggers can therefore drive one canonical JSON-LD graph.

That same loop appears in a browser button, CLI command, HTTP handler, queue worker, cron job, or webhook. Only the trigger adapter changes.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The DAG is the same for every trigger; the runner owns when it starts. [The Dispatcher](./the-dispatcher) is the browser-runnable example: customer send and operator resume are two UI triggers around the same registered `support-dispatcher` DAG.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher runner DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

Every application that runs a DAG from a UI button, CLI script, HTTP handler, or event loop independently derives the same loop: build a dispatcher, register bundles, seed initial state, call `execute` or `resume`, route the outcome, and project a result. The Dispatcher runner is the browser version of that loop.

### Run

```bash
npm run docs:dev
```

Open [The Dispatcher](./the-dispatcher).

## What It Lets You Do

Runners let applications separate trigger handling from DAG behavior. Use this when the same graph must start from a browser event, CLI command, HTTP request, queue message, or resume event while keeping registration, state seeding, execution, and projection in one host boundary.

This keeps the DAG portable. You can move a flow from a demo UI to a service endpoint without rewriting the graph as long as the runner supplies the same bundles, state, and resume contract.

## Code Samples

#### The support DAG

The runnable support DAG classifies the message, composes or parks, and converges on `send-response`.

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

#### Browser run trigger

The customer **Send** button seeds `DispatcherState`, registers the live nodes and DAG, then executes `support-dispatcher`.

<<< @/../docs/.vitepress/theme/components/DispatcherRunner.vue#dispatcher-browser-run

#### Browser resume trigger

The operator **Send response** button restores the parked checkpoint and resumes the same DAG from the parked cursor.

<<< @/../docs/.vitepress/theme/components/DispatcherRunner.vue#dispatcher-browser-resume

### Trigger mapping

The same runner pattern applies outside the browser:

| Browser trigger | Runner equivalent |
|-----------------|-------------------|
| Customer **Send** | request/event trigger calls `run` |
| Operator **Send response** | request/event trigger calls `resume` |
| Config toggles | `seedState` input mapping |
| Conversation panel | `projectResult` view projection |

## Details for Nerds

- **Run loop ownership.** The browser runner owns dispatcher construction, bundle registration, state seeding, execution, and projection.
- **Separate triggers, same DAG.** Customer send and operator resume trigger different entry actions around the same DAG document.
- **Resume path.** The runner captures and restores checkpoint state before calling `dispatcher.resume`.
- **Import path.** The reusable class-based runner surface for non-browser adapters ships through `@studnicky/dagonizer/runner`.

## Related Concepts

- [Reference: Runner](../reference/runner) - Full API surface for DagRunner and all trigger variants
- [Reference: Contracts](../reference/contracts) - TriggerInterface adapter contract
- [Example 08: Checkpoint and Resume](./08-checkpoint) - DagRunner.resume() picks up from a checkpoint cursor
- [Authoring DAGs](../guide/authoring)
