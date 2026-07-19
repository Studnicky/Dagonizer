---
title: 'Example 18: Observability'
description: 'Subclass hooks — the observability API. Override onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError, onPhaseEnter, and onPhaseExit on a Dagonizer subclass.'
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

## Lifecycle Hook Surface

Observability is how a host turns Dagonizer execution into trace rows, metrics, progress panes, logs, or telemetry spans. The Dispatcher support runtime uses the hook API to render a live trace beside the running DAG.

The integration point is intentionally narrow: subclass `Dagonizer` and override the protected lifecycle hooks. The graph stays the graph; observation lives at the runtime boundary.

## Observable Support Flow

### DAG registration and diagram

The executable [Dispatcher](./the-dispatcher) workflow implements this directly: `DispatcherBrowserObserver` subclasses the engine observer hooks and drives the trace feed plus Cytoscape DAG pane from lifecycle callbacks.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher observable DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

Subclass hooks are the sole observability API. Extend `Dagonizer` and override the protected hook methods — no extra objects, no plugin contract.

### Run

```bash
pnpm run site:dev
```

Visit [The Dispatcher](./the-dispatcher) and watch the Trace and DAG panes while a support turn executes.

## Hook Projection Model

The dispatcher calls protected `on*` hooks around every execution boundary. A subclass translates those callbacks into domain events, UI state, or telemetry spans. Nested and contained execution includes `placementPath`, so hosts can identify the full ancestry of an observed node even when embedded DAGs reuse display names.

This keeps observability out of node logic. Nodes return declared outputs; the runtime reports the flow around them.

## Code Samples

The Dispatcher runner snippet shows the observer subclass and how hook callbacks become trace entries in the trace pane.

<<< @/../examples/the-dispatcher/app/DispatcherRunner.vue#dispatcher-browser-observer

## Operational Uses

Observability hooks let hosts project the engine lifecycle without changing DAG topology. They expose node starts, node ends, errors, phase hooks, nested placement paths, and final outcomes as they happen.

UI progress, OpenTelemetry spans, audit logs, and per-node timing belong at this boundary. Routing still belongs in node outputs and DAG edges.

## Runtime Notes

- **Subclass hook API.** Override the protected lifecycle methods on `Dagonizer`. All seven hooks receive strongly-typed state and placement context: `onFlowStart(dagName, state)`, `onFlowEnd(dagName, state, result)`, `onNodeStart(nodeName, state, placementPath)`, `onNodeEnd(nodeName, output, state, placementPath)`, `onError(nodeName, error, state, placementPath)`, `onPhaseEnter(dagName, phase, placementName, state, placementPath)`, `onPhaseExit(dagName, phase, placementName, state, placementPath)`.
- **`placementPath` ancestry.** Empty for top-level nodes; carries the ordered list of parent embedded-DAG placement identifiers for nested nodes. Use the placement path plus node display name for a display trace label, and keep the placement IRI for durable identity.
- **Worker/container transparency.** For nodes running in isolates (worker threads, child processes), `WorkerObserver` bridges events through an `ObserverRelay` back to the parent dispatcher's protected hooks. The `placementPath` starts with the outer placement identifier so inner nodes are identifiable even when they share display names across placements.
- **Runnable visualization.** The Dispatcher DAG pane and trace feed are populated from the same hooks shown above.

## Related Concepts

- [Observability guide](../guide/observability) - full hook reference and metrics patterns
- [Example 20: Streaming](./20-streaming) - async-iterable execution API: per-node progress events
- [Reference: Dagonizer](../reference/dagonizer)
