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

# Example 18: Observability

Subclass hooks are the sole observability surface. Extend `Dagonizer` and override the protected hook methods — no extra objects, no plugin contract.

## Code

<<< @/../examples/18-observability.ts

## What it demonstrates

- **Subclass hook surface.** Override the protected lifecycle methods on `Dagonizer`. All seven hooks receive strongly-typed state and placement context: `onFlowStart(dagName, state)`, `onFlowEnd(dagName, state, result)`, `onNodeStart(nodeName, state, placementPath)`, `onNodeEnd(nodeName, output, state, placementPath)`, `onError(nodeName, error, state, placementPath)`, `onPhaseEnter(dagName, phase, placementName, state, placementPath)`, `onPhaseExit(dagName, phase, placementName, state, placementPath)`.
- **`placementPath` ancestry.** Empty for top-level nodes; carries the ordered list of parent embedded-DAG placement names for nested nodes. Use `[...placementPath, nodeName].join('/')` for a fully-qualified node id.
- **Worker/container transparency.** For nodes running in isolates (worker threads, child processes), `WorkerObserver` bridges events through an `ObserverRelay` back to the parent dispatcher's protected hooks. The `placementPath` starts with the outer placement name so inner nodes are identifiable even when they share names across placements.
- **Multi-observer composition.** To combine logging, tracing, and metrics, write each concern into the subclass body. No multiplexer is required.

## Run

```bash
npx tsx examples/18-observability.ts
```
