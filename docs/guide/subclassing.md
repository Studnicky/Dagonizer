---
title: 'Subclassing state'
description: 'NodeStateBase is the canonical base class for domain-specific DAG state. Extend it to add typed fields, override snapshotData and restoreData for checkpoint round-trips, and override clone for deep-copy semantics across scatter clone boundaries.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'register nodes that read and write your custom state subclass'
  - text: 'Checkpoint and resume'
    link: './checkpoint'
    description: 'snapshotData and restoreData round-trip domain fields across abort and resume'
  - text: 'Observability'
    link: './observability'
    description: 'dispatcher hooks fire on subclass instances unchanged'
nextSteps:
  - text: 'Checkpoint and resume'
    link: './checkpoint'
    description: 'capture, persist, and recall a subclassed state'
---

# Subclassing state

`NodeStateBase` is the canonical base class for DAG state. Subclasses add typed fields that nodes read and write. The dispatcher accepts any `NodeStateBase` subclass as the generic state parameter; the lifecycle, metadata, and error/warning machinery live in the base class and remain available without re-declaration.

## Basic subclass

<<< @/../examples/dags/subclassing.ts#basic-subclass

Nodes typed `NodeInterface<PipelineState, TOutput>` access `state.items`, `state.processedIds`, and `state.totalCost` directly. The constructor initialises every field in declaration order, which preserves V8 hidden-class stability across instances.

## Snapshot and restore

The Archivist demo carries a rich state object: `query`, `terms`, `candidates`, `shortlist`, `draft`, `recalledContext`, `memoryDigest`. The `snapshotData` and `restoreData` overrides serialise every domain field to a JSON-safe shape and rehydrate from a captured snapshot:

<<< @/../examples/the-archivist/ArchivistState.ts#snapshot-restore

`snapshotData()` returns a `JsonObject`. The base class merges it with the base snapshot (metadata, retries, warnings) and serialises the result. Lifecycle and engine errors are intentionally excluded: lifecycle resets to `pending` on resume, and errors flow via `outcome.errors`. `restoreData()` receives the merged snapshot; it reads only the domain fields and assigns them onto the instance with the type guards visible above.

Two invariants the override must hold:

1. **JSON-safe output**. Arrays and plain objects only; `Map`, `Set`, `Date`, `BigInt`, class instances, and circular references all fail. Convert `Set` to an array, `Map` to a record, `Date` to an ISO string before returning.
2. **Idempotent reads**. `restoreData` must tolerate missing or wrong-typed fields. The guards (`typeof snap['query'] === 'string'`) keep an older snapshot loadable after the state shape evolves.

## `clone()`

The dispatcher calls `clone()` before scatter clones so each clone operates on its own state copy. The base implementation copies metadata via `structuredClone` and resets the lifecycle plus error/warning lists. Override `clone()` when the subclass carries reference-typed fields the base class does not know about:

<<< @/../examples/dags/subclassing.ts#clone-manual

The base `clone()` resets lifecycle to `pending` and clears errors and warnings. Call `super.clone()` to keep that behaviour and layer the domain copy on top:

<<< @/../examples/dags/subclassing.ts#clone-super

## Static `restore`

`NodeStateBase.restore` is a static method with `this`-polymorphism. Subclasses inherit it without re-declaration:

<<< @/../examples/dags/subclassing.ts#static-restore

When `restoreData()` is overridden, `restore()` calls `applySnapshot()` which calls `restoreData()`. No re-implementation needed.

## Full example

<<< @/../examples/subclassing.ts#full-example

## Retry-attempt tracking

`NodeStateBase` carries a retry counter keyed by a routing name (typically `context.nodeName`). Retry is a flow shape: the counter lives in state, the loop edge lives in the DAG topology. Nodes do not contain retry logic; they call `state.withinRetryBudget(key, max)` to decide which output to return and the DAG wires the edge back to the failing node.

| Method | Signature | Description |
|--------|-----------|-------------|
| `recordAttempt` | `(key: string): number` | Increment and return the new attempt count for `key`. |
| `retriesFor` | `(key: string): number` | Current attempt count for `key` (`0` when never recorded). |
| `clearAttempts` | `(key: string): void` | Reset the counter for `key`. Call on success so a reused placement starts fresh. |
| `withinRetryBudget` | `(key: string, maxAttempts: number): boolean` | Record one attempt and return `true` if still within budget (`→ retry` output) or `false` if exhausted (`→ salvage`). |

A typical node that participates in a retry loop:

<<< @/../examples/dags/subclassing.ts#retry-budget-node

The DAG topology provides the loop: the `retry` output edges back to `fetch`; `salvage` routes forward to a recovery node. The counter is included in `snapshot()` (under the `retries` map in `NodeStateData`), so a retry budget survives checkpoint and resume.

## Related reference

- [Reference, Lifecycle](../reference/lifecycle)
- [Reference, Entities, `NodeStateData`](../reference/entities)
- [Reference, Checkpoint](../reference/checkpoint)
