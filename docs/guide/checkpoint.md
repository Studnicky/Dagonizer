---
title: 'Checkpoint and Resume'
description: 'Checkpoint.capture persists the interrupted execution graph and restoreState rehydrates it through the graph port.'
seeAlso:
  - text: 'Persistence'
    link: './persistence'
    description: 'configure checkpoint storage and graph adapters'
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'declare typed graph-backed application state'
---

# Checkpoint and Resume

Checkpointing persists one named run graph. The graph contains lifecycle,
metadata, retry, progress, and application state facts. JSON-LD is the
Node.js-facing intermediate representation; checkpoint persistence and
streaming transfers use N-Quads for the same graph.

```ts
const checkpoint = await Checkpoint.capture(dagIri, result);
await checkpoint.persist(store, key);

const recalled = await Checkpoint.recall(store, key);
const { state, cursor } = await recalled.restoreState(
  CheckpointRestoreAdapter.wrap(() => new PipelineState()),
);
await dispatcher.resume(dagIri, state, cursor);
```

`Checkpoint.capture` rejects completed executions without a resume cursor.
`Checkpoint.load` validates the envelope before graph data is imported.
`restoreState` constructs a fresh state through the injected factory and
restores the stored JSON-LD graph into its graph port.

## Named stores

Named stores remain independent persistence resources. They use the shared
store snapshot contract because they are not node state; the node execution
state itself always travels through the graph dataset. A checkpoint therefore
contains one graph state document plus any explicitly requested store records.

## Scatter and workset progress

Scatter acknowledgements and workset records are graph-backed progress data.
Completed records can be compacted or pruned only when no live checkpoint,
resume cursor, parked interaction, or durable-memory reference depends on
them. Retention is an explicit graph lifecycle operation, not an implicit
overwrite or unbounded append.
