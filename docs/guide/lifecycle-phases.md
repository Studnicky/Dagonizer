# Lifecycle phases

`PhaseNode` placements run around the main DAG loop rather than inside it. They are first-class placements — registered like any other, can mutate state, can throw, and are observed by the dispatcher hooks and the `Instrumentation` surface.

Two arms:

- `phase: 'pre'` — runs BEFORE the entrypoint, in DAG declaration order.
- `phase: 'post'` — runs AFTER the main loop drains, in DAG declaration order, on every exit path.

Phase placements have no `outputs` field. They never route to other placements. They are never the main-loop entrypoint.

## When to reach for it

Pre/post phases fit the bootstrap / teardown shape:

- Pre: warm a cache, attach an observability span, validate environment, bind a request-scoped logger to `state.metadata`.
- Post: flush metrics, close a database handle, persist a final checkpoint, emit a `flow-finished` event.

These are real units of work that participate in the DAG. They are not the same as the `onFlowStart` / `onFlowEnd` observer hooks — those are observability-only and do not register as nodes, do not show up in `executedNodes`, and cannot mutate state through the `NodeInterface` contract.

## Failure semantics

| Path | Pre-phase throws | Main loop throws | Post-phase throws |
|------|------------------|------------------|-------------------|
| Lifecycle | `failed` | already-set (`failed`, `cancelled`, `timed_out`) | **unchanged** |
| Main loop executes | no | partially | n/a |
| Post-phases execute | yes | yes | yes (errors collected as warnings) |

Pre-phase failures abort the run before the entrypoint sees state. Post-phase failures never overwrite the lifecycle — they are collected as warnings on `state` with code `POST_PHASE_FAILED` and the loop continues with the next post-phase. This matches the "best-effort teardown" shape: a failed log flush should not flip a successful run into a failure.

## `ExecutionResult.executedNodes`

- Pre-phase names appear at the START (every pre-phase that ran without throwing).
- Main-loop nodes appear in the MIDDLE (existing behaviour).
- Post-phase names appear at the END (every post-phase that completed without throwing).

A pre-phase that threw is not appended. A post-phase that threw is not appended.

## Authoring

The fluent surface lives on `DAGBuilder`:

```ts
import { DAGBuilder } from '@noocodex/dagonizer/builder';

const dag = new DAGBuilder('pipeline', '1')
  .node('ingest', ingestNode, { success: 'process' })
  .node('process', processNode, { success: null })
  .phase('warm-cache',  'pre',  warmCacheNode)
  .phase('flush-logs',  'post', flushLogsNode)
  .phase('close-db',    'post', closeDbNode)
  .build();
```

Phase placements are recorded in DAG declaration order. Order matters — `warm-cache` runs strictly before `ingest`; `flush-logs` runs strictly before `close-db`.

The hand-written JSON form is also accepted:

```jsonc
{
  "@id":   "urn:noocodex:dag:pipeline/node/warm-cache",
  "@type": "PhaseNode",
  "name":  "warm-cache",
  "node":  "warm-cache-node",
  "phase": "pre"
}
```

## Validation

At `registerDAG` time the engine verifies that every `PhaseNode.node` resolves to a registered node. A missing reference raises `DAGError`. The schema rejects an `outputs` field (no routing) and rejects any `phase` value outside `'pre' | 'post'`.

## Instrumentation

For every phase placement the dispatcher invokes:

```ts
instrumentation.phaseEnter(dagName, 'pre' | 'post', placementName, state);
// ... await node.execute(state, context)
instrumentation.phaseExit(dagName,  'pre' | 'post', placementName, state);
```

See [observability](./observability) for the full instrumentation surface.

## Related reference

- [Builder — `.phase()`](./builder#phase-name-phase-node)
- [Observability](./observability)
