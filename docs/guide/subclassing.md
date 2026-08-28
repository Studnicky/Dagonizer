---
title: 'Subclassing State'
description: 'NodeStateBase provides the graph-backed state port for typed DAG state.'
seeAlso:
  - text: 'Checkpoint and Resume'
    link: './checkpoint'
    description: 'persist and restore the run graph through JSON-LD'
---

# Subclassing State

## State Model

`NodeStateBase` is the base class for host state. A subclass declares
typed fields for Node.js callers and maps those fields to graph facts through
`graphStateFields()`, or exposes accessors backed by the protected
`getGraphStateField` and `setGraphStateField` methods.

The graph is the only state model. JSON-LD is the Node.js intermediate
representation used by checkpoints and transport; N-Quads is the streaming and
persistence representation of the same graph.

## Examples and References

No standalone DAG applies here. These examples and references show graph-backed state in running code:

- [Example 08: Checkpoint and Resume](../examples/08-checkpoint) - persists and restores a `NodeStateBase` subclass through the graph port
- [State Accessors](./state-accessor) - `StateAccessor` contract that reads and writes the same state object
- [Checkpoint and Resume](./checkpoint) - the codec/store layer that carries subclass state across runs

## Graph-backed Access

A subclass wires typed getters and setters to the graph through
`getGraphStateField` / `setGraphStateField`, or declares `graphStateFields()`
for a bulk mapping. Nodes then use the typed accessor (`state.items`) directly;
lifecycle, metadata, retry counters, errors, warnings, and host fields
all persist through the shared graph dataset. `clone()` forks that dataset for
isolated execution, and graph restoration rehydrates the subclass through its
graph-backed accessors.

## Code Samples

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

Pass a fresh state factory to `CheckpointRestoreAdapter` to wire a subclass
into checkpoint restore:

```ts
CheckpointRestoreAdapter.wrap(() => new PipelineState());
```

`Checkpoint.capture` writes the run graph and `restoreState` imports its
context-bound JSON-LD document into the newly constructed state. No subclass
serialization hooks or object snapshots are involved.

## Operational Uses

Subclass `NodeStateBase` whenever a DAG's domain state needs typed,
Node.js-facing accessors instead of raw graph reads and writes. The same
subclass gets checkpoint/resume, cloning for isolated execution, and retry
bookkeeping for free, because all of it rides the shared graph dataset rather
than bespoke serialization code.

## Runtime Notes

### Retry state

`recordAttempt`, `retriesFor`, `clearAttempts`, and `withinRetryBudget` store
retry facts in the run graph. The DAG topology still owns retry routing; the
state only carries the observed attempt count.

## Related Concepts

- [Checkpoint and Resume](./checkpoint) - persist and restore the run graph through JSON-LD
