---
title: 'Subclassing state'
description: 'NodeStateBase is the canonical base class for domain-specific DAG state. Extend it to add typed fields, override snapshotData and restoreData for checkpoint round-trips, and override clone for deep-copy semantics across fan-out and embedded-DAG boundaries.'
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

The Archivist demo carries a rich state object: `query`, `terms`, `candidates`, `shortlist`, `draft`, `recalledContext`, `memoryDigest`. The `snapshotData` and `restoreData` overrides serialise every domain field to a JSON-safe shape and rehydrate from a previously captured snapshot:

<<< @/../examples/the-archivist/ArchivistState.ts#snapshot-restore

`snapshotData()` returns a `JsonObject`. The base class merges it with the base snapshot (metadata, lifecycle, errors, warnings) and serialises the result. `restoreData()` receives the merged snapshot; it reads only the domain fields and assigns them onto the instance with the type guards visible above. The base class restores the lifecycle separately, then calls `restoreData()` to repopulate the domain shape.

Two invariants the override must hold:

1. **JSON-safe output**. Arrays and plain objects only; `Map`, `Set`, `Date`, `BigInt`, class instances, and circular references all fail. Convert `Set` to an array, `Map` to a record, `Date` to an ISO string before returning.
2. **Idempotent reads**. `restoreData` must tolerate missing or wrong-typed fields. The guards (`typeof snap['query'] === 'string'`) keep an older snapshot loadable after the state shape evolves.

## `clone()`

The dispatcher calls `clone()` before fan-out items and embedded-DAG calls so each branch operates on its own state copy. The base implementation copies metadata via `structuredClone` and resets the lifecycle plus error/warning lists. Override `clone()` when the subclass carries reference-typed fields the base class does not know about:

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

const tick: NodeInterface<CountState, 'success'> = {
  name: 'tick',
  outputs: ['success'],
  async execute(state) {
    state.count++;
    state.log.push(`tick:${state.count}`);
    return { output: 'success' };
  },
};

const dag: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:count',
  '@type':    'DAG',
  name: 'count', version: '1', entrypoint: 'a',
  nodes: [
    { '@id': 'urn:noocodex:dag:count/node/a', '@type': 'SingleNode', name: 'a', node: 'tick', outputs: { success: 'b' } },
    { '@id': 'urn:noocodex:dag:count/node/b', '@type': 'SingleNode', name: 'b', node: 'tick', outputs: { success: 'c' } },
    { '@id': 'urn:noocodex:dag:count/node/c', '@type': 'SingleNode', name: 'c', node: 'tick', outputs: { success: null } },
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
  (snap) => CountState.restore(snap),
);
const final = await dispatcher.resume(dagName, s2, cursor);
// final.state.count === 3, final.state.log.length === 3
```

## Related reference

- [Reference, Lifecycle](../reference/lifecycle)
- [Reference, Entities, `NodeStateData`](../reference/entities)
- [Reference, Checkpoint](../reference/checkpoint)
