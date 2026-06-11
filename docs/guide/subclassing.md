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

```ts
import { NodeStateBase, Dagonizer } from '@noocodex/dagonizer';

class PipelineState extends NodeStateBase {
  items: string[] = [];
  processedIds = new Set<string>();
  totalCost = 0;
}

const state = new PipelineState();
state.items = ['a', 'b', 'c'];

const dispatcher = new Dagonizer<PipelineState>();
```

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

```ts
class S extends NodeStateBase {
  items: string[] = [];
  config: Config;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  override clone(): S {
    const cloned = new S(this.config); // shared reference is fine here
    // NodeStateBase.clone() copies _metadata via structuredClone
    // but does not know about `items`. Copy it explicitly.
    cloned.items = [...this.items];
    return cloned;
  }
}
```

The base `clone()` resets lifecycle to `pending` and clears errors and warnings. Call `super.clone()` to keep that behaviour and layer the domain copy on top:

```ts
override clone(): S {
  const base = super.clone() as S;
  base.items = [...this.items];
  return base;
}
```

## Static `restore`

`NodeStateBase.restore` is a static method with `this`-polymorphism. Subclasses inherit it without re-declaration:

```ts
const snap = state.snapshot();
const restored = PipelineState.restore(snap);
// restored is PipelineState, not NodeStateBase
```

When `restoreData()` is overridden, `restore()` calls `applySnapshot()` which calls `restoreData()`. No re-implementation needed.

## Full example

```ts
import { NodeStateBase, Dagonizer, Checkpoint, DAG_CONTEXT } from '@noocodex/dagonizer';
import { CheckpointRestoreAdapterFn } from '@noocodex/dagonizer/checkpoint';
import { NodeOutputBuilder, EMPTY_CONTRACT_FRAGMENT } from '@noocodex/dagonizer';
import type { JsonObject, NodeInterface, DAG } from '@noocodex/dagonizer';

class CountState extends NodeStateBase {
  count = 0;
  log: string[] = [];

  protected override snapshotData(): JsonObject {
    return { count: this.count, log: [...this.log] };
  }

  protected override restoreData(snap: JsonObject): void {
    const c = snap['count'];
    if (typeof c === 'number') this.count = c;
    const l = snap['log'];
    if (Array.isArray(l)) this.log = l.filter((x): x is string => typeof x === 'string');
  }
}

class TickNode implements NodeInterface<CountState, 'success'> {
  readonly name = 'tick';
  readonly outputs = ['success'] as const;
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  async execute(state: CountState) {
    state.count++;
    state.log.push(`tick:${state.count}`);
    return NodeOutputBuilder.of('success');
  }
}

const tick = new TickNode();

const dag: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:count',
  '@type':    'DAG',
  name: 'count', version: '1', entrypoint: 'a',
  nodes: [
    { '@id': 'urn:noocodex:dag:count/node/a', '@type': 'SingleNode', name: 'a', node: 'tick', outputs: { success: 'b' } },
    { '@id': 'urn:noocodex:dag:count/node/b', '@type': 'SingleNode', name: 'b', node: 'tick', outputs: { success: 'c' } },
    { '@id': 'urn:noocodex:dag:count/node/c', '@type': 'SingleNode', name: 'c', node: 'tick', outputs: { success: 'end' } },
    { '@id': 'urn:noocodex:dag:count/node/end', '@type': 'TerminalNode', name: 'end', outcome: 'completed' },
  ],
};

const dispatcher = new Dagonizer<CountState>();
dispatcher.registerNode(tick);
dispatcher.registerDAG(dag);

// Run, abort after one node, checkpoint, restore, resume.
const ctl = new AbortController();
const s1 = new CountState();
const exec = dispatcher.execute('count', s1, { signal: ctl.signal });
for await (const node of exec) {
  if (node.nodeName === 'a') ctl.abort(new Error('pause after a'));
}
const partial = await exec;
// partial.state.count === 1, partial.cursor === 'b'

const ckpt = await Checkpoint.capture('count', partial);
const ckpt2 = Checkpoint.load(JSON.parse(ckpt.toJson()) as unknown);
const { state: s2, dagName, cursor } = ckpt2.restoreState(
  CheckpointRestoreAdapterFn.fromFn((snap) => CountState.restore(snap)),
);
const final = await dispatcher.resume(dagName, s2, cursor);
// final.state.count === 3, final.state.log.length === 3
```

## Retry-attempt tracking

`NodeStateBase` carries a retry counter keyed by a routing name (typically `context.nodeName`). Retry is a flow shape: the counter lives in state, the loop edge lives in the DAG topology. Nodes do not contain retry logic; they call `state.withinRetryBudget(key, max)` to decide which output to return and the DAG wires the edge back to the failing node.

| Method | Signature | Description |
|--------|-----------|-------------|
| `recordAttempt` | `(key: string): number` | Increment and return the new attempt count for `key`. |
| `retriesFor` | `(key: string): number` | Current attempt count for `key` (`0` when never recorded). |
| `clearAttempts` | `(key: string): void` | Reset the counter for `key`. Call on success so a reused placement starts fresh. |
| `withinRetryBudget` | `(key: string, maxAttempts: number): boolean` | Record one attempt and return `true` if still within budget (`→ retry` output) or `false` if exhausted (`→ salvage`). |

A typical node that participates in a retry loop:

```ts
import { NodeOutputBuilder } from '@noocodex/dagonizer';
import type { NodeContextInterface, NodeInterface } from '@noocodex/dagonizer';
import { EMPTY_CONTRACT_FRAGMENT } from '@noocodex/dagonizer';

class FetchNode implements NodeInterface<MyState, 'success' | 'retry' | 'salvage'> {
  readonly name = 'fetch';
  readonly outputs = ['success', 'retry', 'salvage'] as const;
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  async execute(state: MyState, context: NodeContextInterface) {
    try {
      state.data = await fetch('/api', { signal: context.signal }).then((r) => r.json());
      state.clearAttempts(context.nodeName);
      return NodeOutputBuilder.of('success');
    } catch {
      const canRetry = state.withinRetryBudget(context.nodeName, 3);
      return NodeOutputBuilder.of(canRetry ? 'retry' : 'salvage');
    }
  }
}
```

The DAG topology provides the loop: the `retry` output edges back to `fetch`; `salvage` routes forward to a recovery node. The counter is included in `snapshot()` (under the `retries` map in `NodeStateData`), so a retry budget survives checkpoint and resume.

## Related reference

- [Reference, Lifecycle](../reference/lifecycle)
- [Reference, Entities, `NodeStateData`](../reference/entities)
- [Reference, Checkpoint](../reference/checkpoint)
