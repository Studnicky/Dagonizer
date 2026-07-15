---
title: 'Subclassing State'
description: 'NodeStateBase provides the graph-backed state port for typed DAG state.'
seeAlso:
  - text: 'Checkpoint and Resume'
    link: './checkpoint'
    description: 'persist and restore the run graph through JSON-LD'
---

# Subclassing State

`NodeStateBase` is the base class for application state. A subclass declares
typed fields for Node.js callers and maps those fields to graph facts through
`graphStateFields()`, or exposes accessors backed by the protected
`getGraphStateField` and `setGraphStateField` methods.

The graph is the only state model. JSON-LD is the Node.js intermediate
representation used by checkpoints and transport; N-Quads is the streaming and
persistence representation of the same graph.

```ts
class PipelineState extends NodeStateBase {
  get items(): readonly string[] {
    return (this.getGraphStateField('items') ?? []) as readonly string[];
  }

  set items(value: readonly string[]) {
    this.setGraphStateField('items', [...value]);
  }
}
```

Nodes use `state.items` directly. Lifecycle, metadata, retry counters, errors,
warnings, and application fields all persist through the shared graph dataset.
`clone()` forks that dataset for isolated execution, and graph restoration
rehydrates the subclass through its graph-backed accessors.

## Checkpoint and resume

Pass a fresh state factory to `CheckpointRestoreAdapter`:

```ts
CheckpointRestoreAdapter.wrap(() => new PipelineState());
```

`Checkpoint.capture` writes the run graph and `restoreState` imports its
context-bound JSON-LD document into the newly constructed state. No subclass
serialization hooks or object snapshots are involved.

## Retry state

`recordAttempt`, `retriesFor`, `clearAttempts`, and `withinRetryBudget` store
retry facts in the run graph. The DAG topology still owns retry routing; the
state only carries the observed attempt count.
