---
title: 'Contract-derived flows'
description: 'DAGDeriver.derive builds a DAG by matching produces ↔ hardRequired; OperationContract declares the data; DAGDeriverAnnotations adds routing patterns the data graph cannot express; ContractRegistryValidator catches dangling reads and writes.'
seeAlso:
  - text: 'Authoring DAGs'
    link: './authoring'
    description: 'when to use DAGBuilder vs DAGDeriver vs raw DAG literals'
  - text: 'DAGBuilder'
    link: './builder'
    description: 'imperative authoring for deterministic and ETL workflows'
  - text: 'Visualization'
    link: './visualization'
    description: 'render the derived DAG as Mermaid'
  - text: 'Schema and JSON loading'
    link: './schema'
    description: 'validate the derived DAG before registering'
---

<script setup lang="ts">
import { NodeOutputBuilder } from '@noocodex/dagonizer';
import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

class ValidateNode implements NodeInterface {
  readonly name = 'validate';
  readonly outputs = ['success', 'error'] as const;
  readonly contract = { hardRequired: ['intermediate'], produces: ['validated'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

class TransformNode implements NodeInterface {
  readonly name = 'transform';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['validated'], produces: ['childResult'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

class PrepareNode implements NodeInterface {
  readonly name = 'prepare';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['input'], produces: ['intermediate'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

class InvokePluginNode implements NodeInterface {
  readonly name = 'invoke-plugin';
  readonly outputs = ['success', 'error'] as const;
  readonly contract = { hardRequired: ['intermediate'], produces: ['childResult'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

class FinalizeNode implements NodeInterface {
  readonly name = 'finalize';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['childResult'], produces: ['final'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

const validate = new ValidateNode();
const transform = new TransformNode();
const prepare = new PrepareNode();
const invokePlugin = new InvokePluginNode();
const finalize = new FinalizeNode();

const childDAG = DAGDeriver.derive({
  name: 'plugin:transform',
  version: '1.0',
  entrypoint: 'validate',
  nodes: [validate, transform],
  annotations: {
    terminals: {
      validate:  [{ outcome: 'error', emit: { name: 'validate-failed', outcome: 'failed' } }],
      transform: [{ outcome: 'success', emit: { name: 'transform-done', outcome: 'completed' } }],
    },
  },
});

const parentDAG = DAGDeriver.derive({
  name: 'parent',
  version: '1.0',
  entrypoint: 'prepare',
  nodes: [prepare, invokePlugin, finalize],
  annotations: {
    embeddedDAGs: {
      'invoke-plugin': {
        dag: 'plugin:transform',
        outputs: ['success', 'error'],
        stateMapping: {
          input:  { intermediate: 'intermediate' },
          output: { childResult: 'childResult' },
        },
      },
    },
    terminals: {
      finalize: [{ outcome: 'success', emit: { name: 'finalize-done', outcome: 'completed' } }],
    },
  },
});

const deriveRegistry = new Map([['plugin:transform', childDAG]]);
</script>

# Contract-derived flows

`DAGDeriver.derive` builds a `DAG` from a registry of `OperationContract`s by matching `produces ↔ hardRequired`. Each operation declares the field paths it needs and the field paths it produces; an edge `A → B` exists when some path in `A.produces` appears in `B.hardRequired`. Operations that share a topological depth and that the `scatters` annotation targets become scatter placements; otherwise they are sequenced by depth.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `DAGDeriver.derive(options)` | `@noocodex/dagonizer/derive` | Static factory: contracts + annotations → `DAG` |
| `DAGDeriver.extractContracts(nodes)` | `@noocodex/dagonizer/derive` | Project `OperationContract[]` from a node registry |
| `OperationContract` | `@noocodex/dagonizer/contracts` | `name`, `hardRequired`, `produces`, `outputs` |
| `OperationContractFragment` | `@noocodex/dagonizer/contracts` | `hardRequired` + `produces` (the `NodeInterface.contract` field) |
| `DAGDeriverAnnotations` | `@noocodex/dagonizer/derive` | `terminals`, `scatters`, `embeddedDAGs` |
| `ContractRegistryValidator` | `@noocodex/dagonizer/derive` | Surfaces dangling reads (fatal) and dead writes (warning) |
| `Chainable<A, B>` | `@noocodex/dagonizer` (also `/types`) | Compile-time pair check; `true` when `A.produces` covers `B.hardRequired` |

`DAGDeriver` is the declarative authoring path for agentic flows where reaching the final state matters more than authoring the order: tool-driven agents, exploratory pipelines, workflows where the operation set changes per deployment. For deterministic ETL pipelines, use [DAGBuilder](./builder). See [Authoring DAGs](./authoring) for the decision matrix.

## The derived topology

The example below derives a parent DAG with one embedded-DAG placement. `prepare` produces `intermediate`; `invoke-plugin` requires it and produces `childResult`; `finalize` requires `childResult`. The `embeddedDAGs` annotation swaps `invoke-plugin` from `SingleNode` to an `EmbeddedDAGNode`:

<DagGraph :dag="parentDAG" :embedded-d-a-gs="deriveRegistry" :expand-all="true" aria-label="Derived parent DAG: prepare → invoke-plugin (embedded-DAG) → finalize, with child DAG validate → transform expanded inline." />

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

- `name`: matches `NodeInterface.name` used at registration with the dispatcher.
- `hardRequired`: field paths on state that must be present for the operation to run.
- `produces`: field paths the operation writes on success.
- `outputs`: output ports the operation can emit. Every port auto-wires to the next derived stage; `annotations.terminals` overrides individual ports per-operation.

## Declaring the contracts

<<< @/../examples/dags/derive.ts#contracts

The runnable example defines nodes with co-located contracts. Each `NodeInterface` carries its own `contract: { hardRequired, produces }` alongside `name` and `outputs`; the node array is passed as `nodes` to `DAGDeriver.derive`. See [Co-located contracts](#co-located-contracts) below for the full pattern.

## Deriving the DAG

<<< @/../examples/dags/derive.ts#derive

Linear chains derive directly. Multi-port operations declare every port in `outputs`; each port auto-wires to the next derived stage so a node with `outputs: ['success', 'cached', 'skipped', 'error']` does not need four separate terminal annotations. Operations that share a topological depth and need concurrent execution are expressed via the `scatters` annotation (scatter over a descriptor source with a dispatching body).

## Annotations

Two routing patterns the data graph cannot express live in `annotations`. The `annotations` block in the runnable example covers the `embeddedDAGs` variant:

<<< @/../examples/dags/derive.ts#annotations

### `terminals`: alternate exits

When an operation has output ports that should terminate the flow (or route to a non-default target) rather than continue to the next derived stage, use `terminals`. Each entry is one of two variants.

#### `target` variant

`target: string` routes the output port to the named existing placement. Use this to send an outcome to a placement already in the DAG rather than the auto-derived next stage.

```ts
class ClassifyNode implements NodeInterface<S, 'success' | 'off-topic' | 'error'> {
  readonly name = 'classify';
  readonly outputs = ['success', 'off-topic', 'error'] as const;
  readonly contract = { hardRequired: ['input'], produces: ['classification'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}
class PlanNode implements NodeInterface<S, 'success'> {
  readonly name = 'plan';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['classification'], produces: ['plan'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

const dag = DAGDeriver.derive({
  name: 'gated',
  version: '1.0',
  entrypoint: 'classify',
  nodes: [new ClassifyNode(), new PlanNode()],
  annotations: {
    terminals: {
      classify: [
        { outcome: 'off-topic', target: 'plan' }, // re-routes off-topic to the plan placement
      ],
    },
  },
});
```

#### `emit` variant: inline TerminalNode synthesis

Use `emit` to end a flow with an explicit `failed` or `completed` lifecycle outcome. The deriver materializes a [`TerminalNode`](../examples/09-terminals) placement and routes the operation's output port to it. `emit` is the way to declare terminal outcomes in the deriver; leaf nodes with no downstream successor must use `emit` to declare their exit terminal.

```ts
class ClassifyNode implements NodeInterface<S, 'success' | 'fail' | 'error'> {
  readonly name = 'classify';
  readonly outputs = ['success', 'fail', 'error'] as const;
  readonly contract = { hardRequired: ['input'], produces: ['classification'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}
class PlanNode implements NodeInterface<S, 'success'> {
  readonly name = 'plan';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['classification'], produces: ['plan'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

const dag = DAGDeriver.derive({
  name: 'gated',
  version: '1.0',
  entrypoint: 'classify',
  nodes: [new ClassifyNode(), new PlanNode()],
  annotations: {
    terminals: {
      classify: [
        { outcome: 'fail',  emit: { name: 'end-fail',  outcome: 'failed' } },
        { outcome: 'error', emit: { name: 'end-error', outcome: 'failed' } },
      ],
    },
  },
});
```

The deriver adds two `TerminalNode` placements (`end-fail` and `end-error`) to `dag.nodes`. When the dispatcher reaches either placement it calls `state.markFailed(...)` and the run ends with `state.lifecycle.kind === 'failed'`.

**Deduplication and conflict detection.** Multiple operations may declare `emit` entries sharing the same `name`; the deriver deduplicates and emits a single `TerminalNode`. If two `emit` entries share a name but disagree on `outcome`, `DAGDeriver.derive` throws `DAGError` identifying both the placement name and the conflicting outcomes.

**Name collision detection.** An `emit.name` that matches an existing operation name throws `DAGError` at derive time.

**Mixing variants.** Both variants can coexist on the same operation:

```ts
terminals: {
  classify: [
    { outcome: 'retry', target: 'classify' },                                         // target: re-route retry back to classify
    { outcome: 'error', emit: { name: 'end-error', outcome: 'failed' } },             // emit: end the flow as failed
  ],
},
```

Cross-link: [Builder `.terminal()`](./builder#terminal) for the imperative equivalent; [Demo 09 Terminals](../examples/09-terminals).

Ports declared in `outputs` but absent from `terminals` auto-wire to the next derived stage. A terminal whose outcome does not appear in the contract's `outputs` throws `DAGError` at derive time; routing-shape mismatches fail fast.

### `scatters`: scatter roots

When an operation dispatches one execution per item from a state-array source, the `scatters` annotation declares the source path, per-item key, registered node, and gather strategy. `DAGDeriverScatter` is a discriminated union over the gather strategy; every variant carries its strategy-specific fields and only those.

#### Strategy `'custom'`: registered gather node

```ts
class PlanNode implements NodeInterface<S, 'success'> {
  readonly name = 'plan';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['input'], produces: ['tasks'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}
class ScoutNode implements NodeInterface<S, 'success'> {
  readonly name = 'scout';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['tasks'], produces: ['scoutResults'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}
class MergeNode implements NodeInterface<S, 'success'> {
  readonly name = 'merge';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['scoutResults'], produces: ['merged'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

const dag = DAGDeriver.derive({
  name: 'scout-flow',
  version: '1.0',
  entrypoint: 'plan',
  nodes: [new PlanNode(), new ScoutNode(), new MergeNode()],
  annotations: {
    scatters: {
      scout: {
        source:      'tasks',
        itemKey:     'currentTask',
        node:        'scout',
        concurrency: 3,
        strategy:    'custom',
        customNode:  'merge',
        outcomes:    ['all-success', 'partial', 'all-error', 'empty'],
      },
    },
  },
});
```

The gather operation is registered with the dispatcher and invoked through the `custom` strategy; the dispatcher stages the per-clone records under `state.metadata.gatherResults`.

#### Strategy `'partition'`: per-outcome state buckets

```ts
annotations: {
  scatters: {
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

Every per-outcome item array writes to the declared state path. `partitions` keys must appear in `outcomes` (validated at derive time; out-of-band keys throw `DAGError`).

#### Strategy `'append'`: single flat output

```ts
annotations: {
  scatters: {
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

### `embeddedDAGs`: nested DAG composition

When an operation delegates execution to a nested registered DAG (plugin dispatch, phase composition, runtime-resolved child flows). The contract still declares `produces ↔ hardRequired` for topology derivation; the annotation swaps the rendered placement from `SingleNode` to an `EmbeddedDAGNode`. The `stateMapping.input` seeds child-state fields from the parent before the child runs; `stateMapping.output` copies child-state fields back into the parent after the child completes.

```ts
class FetchNode implements NodeInterface<S, 'success' | 'cached' | 'error'> {
  readonly name = 'fetch';
  readonly outputs = ['success', 'cached', 'error'] as const;
  readonly contract = { hardRequired: ['url'], produces: ['html'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}
class ParseNode implements NodeInterface<S, 'success' | 'error'> {
  readonly name = 'parse';
  readonly outputs = ['success', 'error'] as const;
  readonly contract = { hardRequired: ['html'], produces: ['record'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}
class PersistNode implements NodeInterface<S, 'success'> {
  readonly name = 'persist';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['record'], produces: ['saved'] };
  async execute() { return NodeOutputBuilder.of('success'); }
}

const dag = DAGDeriver.derive({
  name: 'page-pipeline',
  version: '1.0',
  entrypoint: 'fetch',
  nodes: [new FetchNode(), new ParseNode(), new PersistNode()],
  annotations: {
    embeddedDAGs: {
      parse: {
        dag:     'aonprd:parse',         // registered DAG name
        outputs: ['success', 'error'],   // ports the embedded placement routes on
        stateMapping: {
          input:  { html:   'parent.html' },     // input mapping: 'html' clone key ← 'parent.html' parent path
          output: { 'parent.record': 'record' }, // map gather: 'parent.record' parent path ← 'record' clone path
        },
      },
    },
    terminals: {
      parse: [{ outcome: 'error', emit: { name: 'parse-failed', outcome: 'failed' } }],
    },
  },
});
```

- The child DAG name (`'aonprd:parse'`) is resolved at `registerDAG` time. The parent must register the child DAG first; the dispatcher's existing cycle check rejects self-referential embedded-DAG bodies.
- Every port in `embeddedDAG.outputs` auto-wires to the next derived stage (same semantics as `contract.outputs`). `terminals` overrides individual ports.
- A terminal whose outcome is not in `embeddedDAG.outputs` throws `DAGError` at derive time.
- The embedded-DAG placement cannot terminate the run; the parent DAG owns END. The embedded-DAG step must route to another parent placement; if every port routes to `null` the engine rejects the DAG at registration.
- An operation cannot appear in both `scatters` and `embeddedDAGs`; the placement kind must be unambiguous.

#### Typed `stateMapping` via `DAGDeriverEmbeddedDAG<TChildState>`

Supply `TChildState` to narrow `stateMapping.input` keys to names that actually exist on the child state at compile time. The wire shape emitted to the rendered `EmbeddedDAGNode` is always `Record<string, string>`; the generic is for authoring ergonomics only.

```ts
class ParseChildState extends NodeStateBase {
  html   = '';
  record = '';
}

annotations: {
  embeddedDAGs: {
    parse: {
      dag:     'aonprd:parse',
      outputs: ['success', 'error'],
      stateMapping: {
        input:  { html:   'parent.html' },   // 'html' must be a key of ParseChildState
        output: { 'parent.record': 'record' }, // 'record' must be a key of ParseChildState
      },
    } satisfies DAGDeriverEmbeddedDAG<ParseChildState>,
  },
}
```

Omitting `TChildState` (using bare `DAGDeriverEmbeddedDAG`) preserves backward compatibility; the default accepts any string on both sides of the mapping.

## Co-located contracts

Declare `hardRequired` and `produces` directly on the node via `NodeInterface.contract`. The node's own `name` and `outputs` complete the full contract surface; a single object is the one source of truth for both dispatch and topology derivation.

```ts
// Contract lives on the node; single source of truth
class FetchNode implements NodeInterface<MyState> {
  readonly name    = 'fetch';
  readonly outputs = ['success', 'cached', 'error'] as const;
  readonly contract = {
    hardRequired: ['url'] as const,
    produces:     ['raw'] as const,
  };
  async execute(state: MyState, ctx: NodeContextInterface) { /* ... */ return NodeOutputBuilder.of('success'); }
}

const fetchNode = new FetchNode();

// Pass the node registry
const dag = DAGDeriver.derive({
  name: 'pipeline', version: '1.0', entrypoint: 'fetch',
  nodes: [fetchNode, planNode, executeNode],
});
dispatcher.registerNode(fetchNode);
```

Nodes whose `contract` carries empty arrays (`EMPTY_CONTRACT_FRAGMENT`) are silently skipped in topology derivation; the dispatcher still registers and executes them.

Use `DAGDeriver.extractContracts(nodes)` to inspect the projected contracts before derivation:

```ts
const contracts = DAGDeriver.extractContracts([fetchNode, planNode, executeNode]);
// contracts is OperationContract[]; skips nodes without .contract
```

## Catching contract drift

Three mechanisms surface drift between what nodes declare they need and what others provide.

### Type-level: `Chainable<A, B>`

`Chainable<A, B>` resolves to `true` when `B`'s `hardRequired` set is fully satisfied by `A`'s `produces` set, and `never` otherwise. Use it in test helpers or contract authoring to catch drift before running the code.

Most useful when nodes are typed with `as const` literal-tuple contracts:

```ts
import type { Chainable } from '@noocodex/dagonizer/contracts';

class FetchNode implements NodeInterface {
  readonly name    = 'fetch';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['url'] as const, produces: ['raw'] as const };
  async execute() { return NodeOutputBuilder.of('success'); }
}

class ParseNode implements NodeInterface {
  readonly name    = 'parse';
  readonly outputs = ['success'] as const;
  readonly contract = { hardRequired: ['raw'] as const, produces: ['record'] as const };
  async execute() { return NodeOutputBuilder.of('success'); }
}

const fetchNode = new FetchNode();
const parseNode = new ParseNode();

// Compiles: 'raw' in fetchNode.produces satisfies parseNode.hardRequired
type FetchThenParse = Chainable<typeof fetchNode, typeof parseNode>; // true

// Would not compile: parseNode.produces is ['record'], not ['raw']
// type BackwardChain = Chainable<typeof parseNode, typeof fetchNode>; // never
```

### Registration-time: dangling reads

`ContractRegistryValidator` runs automatically during `Dagonizer.registerDAG` for DAGs derived from a `nodes` registry. If any non-entrypoint node `hardRequires` a path that no upstream node `produces`, registration throws a `DAGError`:

```
DAGError: ContractRegistryValidator: node 'plan' hardRequires 'classification'
but no upstream-in-DAG node produces it
```

The same check runs as a preflight inside `DAGDeriver.derive({ nodes })` so contract errors surface before the DAG is built.

The entrypoint node's `hardRequired` paths are treated as external initial state (seeded before execution) and are not checked.

### Registration-time: dead writes

When a node `produces` a path that no downstream node `hardRequires`, `ContractRegistryValidator` calls `Dagonizer.onContractWarning` (a no-op by default). Subclass `Dagonizer` and override `onContractWarning` to surface these warnings:

```ts
class ObservingDispatcher extends Dagonizer<MyState> {
  protected override onContractWarning(message: string): void {
    console.warn('[contract]', message);
  }
}
```

Dead-write warnings are non-fatal; the DAG registers and executes normally. They indicate an operation that writes state no downstream node consumes, which may be intentional (terminal outputs, observability writes) or an authoring oversight.

## Inspecting derived state

`DAGDeriver` also exposes the intermediate computations:

- `DAGDeriver.edges(contracts)`: the adjacency map.
- `DAGDeriver.depthBuckets(contracts, edges)`: operations grouped by topological depth.

Useful for tooling that wants to visualize or analyze the contract graph before producing a DAG.

## DAGDeriver vs DAGBuilder

The two share an output type (`DAG`) but differ in how the topology is authored.

- **DAGDeriver**: declarative. Each operation states what it `hardRequired`s and `produces`; the edge set falls out of the data graph. Adding a new operation is one contract; the topology rewires automatically. Multi-port nodes declare every port in `outputs`; all ports auto-wire to the next derived stage with one field. Best when the natural ordering is "X needs the output of Y" and the alternate exits are sparse enough to enumerate in `annotations.terminals`.
- **DAGBuilder**: imperative. Each `.node(name, nodeRef, routes)` call wires every port to a specific target by hand. Better when the routing is non-uniform across ports (different ports route to different next-stages), when topology depends on runtime conditions, or when the graph has cycles that the data-flow ordering would reject.

Multi-port nodes work in both: DAGDeriver auto-wires all ports uniformly plus terminals for exceptions; DAGBuilder requires every port spelled out in `routes`. The break-even point: 3+ ports with mostly-uniform routing favors DAGDeriver; 3+ ports with mostly-divergent routing favors DAGBuilder.

## Related reference

- [Reference: Derive](../reference/derive)
- [Reference: Contracts](../reference/contracts)
- [Demo: derive example](https://github.com/Studnicky/Dagonizer/blob/main/examples/derive.ts)
