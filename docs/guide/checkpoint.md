---
title: 'Checkpoint and Resume'
description: 'Checkpoint.capture persists the interrupted execution graph and restoreState rehydrates it through the graph port.'
seeAlso:
  - text: 'Persistence'
    link: './persistence'
    description: 'configure checkpoint storage and graph adapters'
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'declare typed graph-backed host state'
---

# Checkpoint and Resume

## Checkpoint Model

Checkpointing persists one named run graph. The graph contains lifecycle,
metadata, retry, progress, and host state facts. JSON-LD is the
Node.js-facing intermediate representation; checkpoint persistence and
streaming transfers use N-Quads for the same graph.

`Checkpoint` and `restoreState` exist so an interrupted execution can be
captured, stored, and later rehydrated in a fresh process without any
subclass-specific serialization code.

## Examples and References

No standalone DAG applies here. These examples and references show the same capture, persist, restore, and resume contract in running code:

- [Example 08: Checkpoint and Resume](../examples/08-checkpoint) - The Archivist mid-conversation: persist, restore, and resume from cursor
- [Example 23: Checkpoint Store](../examples/23-checkpoint-store) - full checkpoint-store lifecycle: abort, capture, persist, recall, restore, resume
- [Checkpoint Persistence](./persistence) - store adapters (Postgres, Redis, S3, memory)
- [Reference: Checkpoint](../reference/checkpoint)

## Persistence Contract

`Checkpoint.capture` rejects completed executions without a resume cursor, so
only interruptible runs produce a checkpoint. `checkpoint.persist` writes the
captured graph to a store. `Checkpoint.recall` reads it back, and
`Checkpoint.load` validates the envelope before graph data is imported.
`restoreState` constructs a fresh state through the injected factory and
restores the stored JSON-LD graph into its graph port, handing back both the
rehydrated state and the resume cursor for `dispatcher.resume`.

## Code Samples

```ts
const checkpoint = await Checkpoint.capture(dagIri, result);
await checkpoint.persist(store, key);

const recalled = await Checkpoint.recall(store, key);
const { state, cursor } = await recalled.restoreState(
  CheckpointRestoreAdapter.wrap(() => new PipelineState()),
);
await dispatcher.resume(dagIri, state, cursor);
```

## Operational Uses

`Checkpoint` handles executions that must survive a process boundary:
pausing a long-running flow, moving a run between machines, or
recovering after a crash. Combine it with named stores and scatter/workset
retention (below) when the run also needs independent snapshot resources or
long-lived progress data that outlives any single checkpoint.

## Runtime Notes

### Named stores

Named stores remain independent persistence resources. They use the shared
store snapshot contract because they are not node state; the node execution
state itself always travels through the graph dataset. A checkpoint therefore
contains one graph state document plus any explicitly requested store records.

### Scatter and workset progress

Scatter acknowledgements and workset records are graph-backed progress data.
Completed records can be compacted or pruned only when no live checkpoint,
resume cursor, parked interaction, or durable-memory reference depends on
them. Retention is an explicit graph lifecycle operation, not an implicit
overwrite or unbounded append.

## Related Concepts

- [Persistence](./persistence) - configure checkpoint storage and graph adapters
- [Subclassing State](./subclassing) - declare typed graph-backed host state
