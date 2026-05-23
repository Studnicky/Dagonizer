---
seeAlso:

  - text: 'DAGBuilder'

    link: './builder'
    description: 'register nodes that accept your custom `NodeStateBase` subclass'

  - text: 'Checkpoint'

    link: './checkpoint'
    description: 'override `snapshotData` / `restoreData` to round-trip domain fields'

  - text: 'Observability'

    link: './observability'
    description: 'your subclass also picks up the dispatcher hooks'
---

# Subclassing State

`NodeStateBase` is the canonical base class for domain-specific state. Extend it to add typed fields that nodes can read and write.

## Basic subclass

```ts
import { NodeStateBase } from '@noocodex/dagonizer';

class PipelineState extends NodeStateBase {
  items: string[] = [];
  processedIds = new Set<string>();
  totalCost = 0;
}

const state = new PipelineState();
state.items = ['a', 'b', 'c'];

const dispatcher = new Dagonizer<PipelineState>();
```

Nodes typed `NodeInterface<PipelineState, TOutput>` can access `state.items`, `state.processedIds`, and `state.totalCost` directly.

## Snapshot and restore

For checkpoint support, override `snapshotData()` and `restoreData()`:

```ts
import { NodeStateBase } from '@noocodex/dagonizer';
import type { JsonObject } from '@noocodex/dagonizer';

class PipelineState extends NodeStateBase {
  items: string[] = [];
  processedCount = 0;

  protected override snapshotData(): JsonObject {
    return {
      items: [...this.items],
      processedCount: this.processedCount,
    };
  }

  protected override restoreData(snap: JsonObject): void {
    const raw = snap['items'];
    if (Array.isArray(raw)) this.items = raw as string[];
    const n = snap['processedCount'];
    if (typeof n === 'number') this.processedCount = n;
  }
}
```

`snapshotData()` must return a JSON-safe `JsonObject`. `restoreData()` receives the full snapshot (base fields merged with domain fields). The lifecycle is not captured — resume always starts from `pending`.

## `clone()`

The dispatcher calls `clone()` before fan-out items and sub-DAG calls. The base implementation clones metadata and resets lifecycle + errors/warnings. Override `clone()` when a subclass has reference-typed fields that need deep copying:

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

The base `clone()` resets lifecycle to `pending` and clears errors/warnings. Call `super.clone()` if you want that behavior plus your additions:

```ts
override clone(): S {
  const base = super.clone() as S;
  base.items = [...this.items];
  return base;
}
```

## Static `restore`

`NodeStateBase.restore` is a static method with `this`-polymorphism. Subclasses inherit it without re-declaring:

```ts
const snap = state.snapshot();
const restored = PipelineState.restore(snap);
// restored is PipelineState, not NodeStateBase
```

When `restoreData()` is overridden, `restore()` calls `applySnapshot()` which in turn calls `restoreData()`. No re-implementation needed.

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

// Run, checkpoint, restore, resume.
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

- [Reference: Lifecycle](../reference/lifecycle)
- [Reference: Entities — `NodeStateData`](../reference/entities)
