---
title: 'Example 18: Observability'
description: 'Subclass hooks — the single observability surface. Override onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError, onPhaseEnter, and onPhaseExit on a Dagonizer subclass.'
seeAlso:
  - text: 'Observability guide'
    link: '../guide/observability'
    description: 'full hook reference and metrics patterns'
  - text: 'Example 20: Streaming'
    link: './20-streaming'
    description: 'async-iterable execution API: per-node progress events'
  - text: 'Reference: Dagonizer'
    link: '../reference/dagonizer'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 18: Observability

## What It Is

Observability is how an application turns Dagonizer execution into trace rows, metrics, progress panes, logs, or telemetry spans. The Dispatcher browser demo uses the hook surface to render a live support-flow trace beside the running DAG.

The integration point is intentionally narrow: subclass `Dagonizer` and override the protected lifecycle hooks. The graph stays the graph; observation lives at the runtime boundary.

## How It Works

The dispatcher calls protected `on*` hooks around every execution boundary. A subclass translates those callbacks into domain events, UI state, or telemetry spans. Nested and contained execution includes `placementPath`, so applications can identify the full ancestry of an observed node even when embedded DAGs reuse names.

This keeps observability out of node logic. Nodes return declared outputs; the runtime reports the flow around them.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Dispatcher](./the-dispatcher) browser demo owns this principle directly: `DispatcherBrowserObserver` subclasses the engine observer surface and drives the trace feed plus Cytoscape DAG pane from lifecycle hooks.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher observable DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

Subclass hooks are the sole observability surface. Extend `Dagonizer` and override the protected hook methods — no extra objects, no plugin contract.

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Observability hooks let applications project the engine lifecycle without changing DAG topology. Use them when the app needs to see node starts, node ends, errors, phase hooks, nested placement paths, and final outcomes as they happen.

This is the right place to integrate UI progress, OpenTelemetry spans, audit logs, or per-node timing. It is not the right place to make routing decisions; routing still belongs in node outputs and DAG edges.

## Code Samples

The Dispatcher runner snippet shows the browser observer subclass and how hook callbacks become trace entries in the runnable page.

<<< @/../docs/.vitepress/theme/components/DispatcherRunner.vue#dispatcher-browser-observer

## Details for Nerds

- **Subclass hook surface.** Override the protected lifecycle methods on `Dagonizer`. All seven hooks receive strongly-typed state and placement context: `onFlowStart(dagName, state)`, `onFlowEnd(dagName, state, result)`, `onNodeStart(nodeName, state, placementPath)`, `onNodeEnd(nodeName, output, state, placementPath)`, `onError(nodeName, error, state, placementPath)`, `onPhaseEnter(dagName, phase, placementName, state, placementPath)`, `onPhaseExit(dagName, phase, placementName, state, placementPath)`.
- **`placementPath` ancestry.** Empty for top-level nodes; carries the ordered list of parent embedded-DAG placement names for nested nodes. Use `[...placementPath, nodeName].join('/')` for a fully-qualified node id.
- **Worker/container transparency.** For nodes running in isolates (worker threads, child processes), `WorkerObserver` bridges events through an `ObserverRelay` back to the parent dispatcher's protected hooks. The `placementPath` starts with the outer placement name so inner nodes are identifiable even when they share names across placements.
- **Runnable visualization.** The Dispatcher DAG pane and trace feed are populated from the same hooks shown above.

## Related Concepts

- [Observability guide](../guide/observability) - full hook reference and metrics patterns
- [Example 20: Streaming](./20-streaming) - async-iterable execution API: per-node progress events
- [Reference: Dagonizer](../reference/dagonizer)
