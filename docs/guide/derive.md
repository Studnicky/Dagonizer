---
seeAlso:

  - text: 'Authoring DAGs'

    link: './authoring'
    description: 'when to use DAGBuilder vs DAGDeriver vs raw DAG literals'

  - text: 'DAGBuilder'

    link: './builder'
    description: 'imperative authoring for deterministic / ETL workflows'

  - text: 'Visualization'

    link: './visualization'
    description: 'render the derived DAG as Mermaid'

  - text: 'Schema & JSON loading'

    link: './schema'
    description: 'validate the derived DAG before registering'
---

# Contract-derived flows

`DAGDeriver` is the declarative authoring path for **agentic flows where reaching the final state matters more than authoring the order** — tool-driven agents, exploratory pipelines, workflows where the operation set changes per deployment, systems where adding a capability is one new contract and the topology rewires itself.

If your flow is a deterministic pipeline where you author the sequence end-to-end (ETL, transformation chains), [DAGBuilder](./builder) is the better fit. See [Authoring DAGs](./authoring) for the decision matrix.

`DAGDeriver.derive` builds a `DAG` from a registry of `OperationContract`s by matching `produces ↔ hardRequired`. Each operation declares the field paths it needs and the field paths it produces; an edge `A → B` exists when some path in `A.produces` appears in `B.hardRequired`. Same-topological-depth operations auto-group into a `ParallelNode` with `combine: 'collect'`; use the `parallels` annotation to override the grouping or pick a different combine strategy.

Adding an operation becomes a one-line registration. The flow topology updates automatically.

## OperationContract

```ts
import type { OperationContract } from '@noocodex/dagonizer/contracts';

const classify: OperationContract = {
  name: 'classify',
  hardRequired: ['input'],
  produces: ['classification'],
  outputs: ['success', 'off-topic'],
};
```

Four fields:

- `name` — matches `NodeInterface.name` used at registration with the dispatcher.
- `hardRequired` — field paths on state that must be present for the operation to run.
- `produces` — field paths the operation writes on success.
- `outputs` — output ports the operation can emit. Every port auto-wires to the next derived stage; `annotations.terminals` overrides individual ports per-operation.

## Deriving a DAG

The data graph (`produces ↔ hardRequired`) the snippet below derives:

```mermaid
flowchart TB
  classify[classify\nproduces: classification]
  plan[plan\nproduces: plan]
  execute[execute\nproduces: result]
  END([end])
  classify -->|classification → hardRequired| plan
  plan -->|plan → hardRequired| execute
  execute --> END
```

```ts
import { DAGDeriver } from '@noocodex/dagonizer/derive';

const dag = DAGDeriver.derive({
  name: 'pipeline',
  version: '1.0',
  entrypoint: 'classify',
  contracts: [
    { name: 'classify', hardRequired: ['input'],          produces: ['classification'], outputs: ['success'] },
    { name: 'plan',     hardRequired: ['classification'], produces: ['plan'],           outputs: ['success'] },
    { name: 'execute',  hardRequired: ['plan'],           produces: ['result'],         outputs: ['success', 'cached', 'error'] },
  ],
});

dispatcher.registerDAG(dag);
```

Linear chains derive directly. Operations sharing a depth (no remaining unsatisfied prerequisites) are wrapped in a `parallel` placement that fires them concurrently and joins to the next depth. **Multi-port operations** — declare every port a node can emit in `outputs`; each port auto-wires to the next derived stage so a node with `outputs: ['success', 'cached', 'skipped', 'error']` doesn't need four separate terminal annotations.

## Annotations

Two routing patterns the data graph cannot express live in `annotations`:

### `terminals` — alternate exits

When an operation has output ports that should terminate the flow (or route to a non-default target) rather than continue to the next derived stage:

```ts
const dag = DAGDeriver.derive({
  name: 'gated',
  version: '1.0',
  entrypoint: 'classify',
  contracts: [
    { name: 'classify', hardRequired: ['input'],          produces: ['classification'], outputs: ['success', 'off-topic', 'error'] },
    { name: 'plan',     hardRequired: ['classification'], produces: ['plan'],           outputs: ['success'] },
  ],
  annotations: {
    terminals: {
      classify: [
        { outcome: 'off-topic', target: null },
        { outcome: 'error',     target: null },
      ],
    },
  },
});
```

Ports declared in `outputs` but absent from `terminals` auto-wire to the next derived stage (`success` → `plan` above). Terminals override individual ports per-operation. A terminal whose outcome doesn't appear in the contract's `outputs` throws `DAGError` at derive time — routing-shape mismatches fail fast.

### `fanouts` — fan-out roots

When an operation dispatches one execution per item from a state-array source, the `fanouts` annotation declares the source path, per-item key, registered node, and fan-in strategy. `DAGDeriverFanOut` is a **discriminated union over the fan-in strategy** — every variant carries its strategy-specific fields and only those.

#### Strategy `'custom'` — registered merge node

```ts
const dag = DAGDeriver.derive({
  name: 'scout-flow',
  version: '1.0',
  entrypoint: 'plan',
  contracts: [
    { name: 'plan',  hardRequired: ['input'],        produces: ['tasks'],        outputs: ['success'] },
    { name: 'scout', hardRequired: ['tasks'],        produces: ['scoutResults'], outputs: ['success'] },
    { name: 'merge', hardRequired: ['scoutResults'], produces: ['merged'],       outputs: ['success'] },
  ],
  annotations: {
    fanouts: {
      scout: {
        source:         'tasks',
        itemKey:        'currentTask',
        node:           'scout',
        concurrency:    3,
        strategy:       'custom',
        fanInOperation: 'merge',
        outcomes:       ['all-success', 'partial', 'all-error', 'empty'],
      },
    },
  },
});
```

The fan-in operation is registered with the dispatcher and invoked through the `custom` strategy; the dispatcher passes the `Record<outcome, item[]>` map to it via `state.metadata.fanInResults`.

#### Strategy `'partition'` — per-outcome state buckets

```ts
annotations: {
  fanouts: {
    scout: {
      source:     'tasks',
      itemKey:    'currentTask',
      node:       'scout',
      strategy:   'partition',
      partitions: { 'success': 'state.passed', 'error': 'state.failed' },
      outcomes:   ['success', 'error', 'empty'],
    },
  },
}
```

Every per-outcome item array writes to the declared state path. `partitions` keys must appear in `outcomes` (validated at derive time — out-of-band keys throw `DAGError`).

#### Strategy `'append'` — single flat output

```ts
annotations: {
  fanouts: {
    scout: {
      source:   'tasks',
      itemKey:  'currentTask',
      node:     'scout',
      strategy: 'append',
      target:   'state.allResults',
      outcomes: ['success', 'error'],
    },
  },
}
```

Every item result (regardless of outcome) is flattened into the array at `target`.

### `parallels` — explicit parallel grouping

By default, DAGDeriver auto-groups same-topological-depth operations into a `ParallelNode` with `combine: 'collect'`. The `parallels` annotation overrides that grouping — declare named groups with the consumer's chosen combine strategy:

```ts
annotations: {
  parallels: {
    'scout-cluster': {
      members: ['openLibraryScout', 'googleBooksScout', 'subjectScout', 'wikipediaScout'],
      combine: 'all-success',
    },
  },
}
```

- Every name in `members` must be a contract in the registry.
- Membership is exclusive — an operation can't appear in two `parallels` groups.
- A `parallels` member can't also appear in `fanouts` or `subDAGs` — placement kind must be unambiguous.
- `combine` is one of `'all-success' | 'any-success' | 'collect'`; the engine routes the parallel's aggregate output through the chosen reduction.

### `subDAGs` — sub-DAG composition

When an operation delegates execution to a nested registered DAG (plugin dispatch, phase composition, runtime-resolved child flows). The contract still declares `produces ↔ hardRequired` for topology derivation; the annotation only swaps the rendered placement from `SingleNode` to `DeepDAGNode`:

```ts
const dag = DAGDeriver.derive({
  name: 'page-pipeline',
  version: '1.0',
  entrypoint: 'fetch',
  contracts: [
    { name: 'fetch',    hardRequired: ['url'],     produces: ['html'],   outputs: ['success', 'cached', 'error'] },
    { name: 'parse',    hardRequired: ['html'],    produces: ['record'], outputs: ['success', 'error'] },
    { name: 'persist',  hardRequired: ['record'],  produces: ['saved'],  outputs: ['success'] },
  ],
  annotations: {
    subDAGs: {
      parse: {
        dag:     'aonprd:parse',         // registered DAG name
        outputs: ['success', 'error'],   // ports the deep-DAG can route on
        stateMapping: {
          input:  { html:   'parent.html' },
          output: { 'parent.record': 'record' },
        },
      },
    },
    terminals: {
      parse: [{ outcome: 'error', target: null }],
    },
  },
});
```

- The child DAG name (`'aonprd:parse'`) is resolved at `registerDAG` time. The parent must register the child DAG first; the dispatcher's existing cycle check rejects self-referential subDAGs.
- Every port in `subDAG.outputs` auto-wires to the next derived stage (same semantics as `contract.outputs`). `terminals` overrides individual ports.
- A terminal whose outcome isn't in `subDAG.outputs` throws `DAGError` at derive time.
- `stateMapping` is forwarded verbatim to the rendered `DeepDAGNode.stateMapping`; controls what crosses the parent/child state boundary.
- Deep-DAG placements cannot terminate the run — the parent DAG owns END. The deep-DAG step must route to another parent placement; if every port routes to `null` the engine rejects the DAG at registration.
- An operation cannot appear in both `fanouts` and `subDAGs`; the placement kind must be unambiguous.

A complete runnable demonstration ships in [`examples/derive.ts`](https://github.com/Studnicky/Dagonizer/blob/main/examples/derive.ts) — declares parent + child contracts, derives both DAGs, dispatches, prints the rendered placement order. Run with `npm run example:derive` or `npx tsx examples/derive.ts`.

## Inspecting derived state

`DAGDeriver` also exposes the intermediate computations:

- `DAGDeriver.edges(contracts)` — the adjacency map.
- `DAGDeriver.depthBuckets(contracts, edges)` — operations grouped by topological depth.

Useful for tooling that wants to visualize or analyze the contract graph before producing a DAG.

## DAGDeriver vs DAGBuilder

The two share an output type (`DAG`) but differ in how the topology is authored:

- **DAGDeriver** — declarative. Each operation states what it `hardRequired`s and `produces`; the edge set falls out of the data graph. Adding a new operation is one contract; the topology rewires automatically. Multi-port nodes declare every port in `outputs`; all ports auto-wire to the next derived stage with one field. Best when the natural ordering is "X needs the output of Y" and the alternate exits are sparse enough to enumerate in `annotations.terminals`.

- **DAGBuilder** — imperative. Each `.node(name, nodeRef, routes)` call wires every port to a specific target by hand. Better when the routing is non-uniform across ports (different ports route to different next-stages), when topology depends on runtime conditions, or when the graph has cycles that the data-flow ordering would reject.

Multi-port nodes work in both: DAGDeriver auto-wires all ports uniformly + terminals for exceptions; DAGBuilder requires every port spelled out in `routes`. The break-even point is roughly: 3+ ports with mostly-uniform routing → DAGDeriver wins; 3+ ports with mostly-divergent routing → DAGBuilder wins.
## Related reference

- [Reference: Derive](../reference/derive)
- [Reference: Contracts — `OperationContract`](../reference/contracts)
