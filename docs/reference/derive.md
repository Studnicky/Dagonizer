---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`OperationContract`, `OperationContractFragment`'
  - text: 'Reference: Entities'
    link: './entities'
    description: '`DAG`, `ParallelNode`, `ScatterNode`'
  - text: 'Reference: Viz'
    link: './viz'
    description: 'render the DAG `derive()` returned'
---

# Derive

Contract-derived flow generation. Ships through `@noocodex/dagonizer/derive`.

```ts
import { DAGDeriver, ContractRegistryValidator } from '@noocodex/dagonizer/derive';
import type {
  DAGDeriverAnnotations,
  DAGDeriverEmitTerminal,
  DAGDeriverEmbeddedDAG,
  DAGDeriverFanOut,
  DAGDeriverTerminal,
  DAGDeriverOptions,
  OperationContract,
  OperationContractFragment,
} from '@noocodex/dagonizer/derive';
```

## DAGDeriver

Static class.

```ts
class DAGDeriver {
  static derive(opts: DAGDeriverOptions): DAG;
  static edges(contracts: readonly OperationContract[]): ReadonlyMap<string, ReadonlySet<string>>;
  static depthBuckets(
    contracts: readonly OperationContract[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
  ): readonly (readonly string[])[];
}
```

### `derive(opts)`

Build a `DAG` from a contract registry plus declared annotations.

```ts
interface DAGDeriverOptions {
  readonly name: string;
  readonly version: string;
  readonly entrypoint: string;
  readonly contracts: readonly OperationContract[];
  readonly annotations?: DAGDeriverAnnotations;
}
```

Operations sharing a topological depth auto-group into a `ParallelNode` with `combine: 'collect'`; use `annotations.parallels` to override the grouping or pick a different combine strategy. Each port in `contract.outputs` routes to the first successor at the next depth; `annotations.terminals` overrides individual ports. When `annotations.fanouts.<name>.strategy === 'custom'`, the referenced `fanInOperation` is emitted as a registered single-node placement alongside the scatter so the dispatcher's `custom` gather reducer can resolve it.

Throws `DAGError` when `contracts` is empty, when a terminal references a port outside the contract's `outputs`, when two `emit` entries share a name but declare conflicting `outcome` values, when an `emit.name` collides with an existing operation name, when a partition outcome isn't in `outcomes`, when a parallel member appears in multiple groups, or when an operation appears in more than one of `fanouts` / `embeddedDAGs` / `parallels`.

### `edges(contracts)`

Adjacency map. An entry `A → B` exists iff some path in `A.produces` appears in `B.hardRequired`. Useful for tooling that wants to inspect the data graph before deriving a DAG.

### `depthBuckets(contracts, edges)`

Topological depth buckets. Operations sharing a depth share a bucket. Same data the renderer uses to decide which placements to wrap in a `parallel`.

---

## DAGDeriverAnnotations

```ts
interface DAGDeriverAnnotations {
  readonly terminals?:    Readonly<Record<string, readonly DAGDeriverTerminal[]>>;
  readonly fanouts?:      Readonly<Record<string, DAGDeriverFanOut>>;
  readonly embeddedDAGs?: Readonly<Record<string, DAGDeriverEmbeddedDAG>>;
  readonly parallels?:    Readonly<Record<string, DAGDeriverParallel>>;
}

type DAGDeriverTerminal =
  | { readonly outcome: string; readonly target: string | null }
  | { readonly outcome: string; readonly emit: DAGDeriverEmitTerminal };

interface DAGDeriverEmitTerminal {
  readonly name:    string;                    // placement name for the synthesized TerminalNode
  readonly outcome: 'completed' | 'failed';   // lifecycle outcome triggered when reached
}

type DAGDeriverFanOut = {
  readonly source:       string;
  readonly itemKey:      string;
  readonly node:         string;
  readonly concurrency?: number;
  readonly outcomes:     readonly string[];
} & (
  | { readonly strategy: 'custom';    readonly fanInOperation: string }
  | { readonly strategy: 'partition'; readonly partitions:    Readonly<Record<string, string>> }
  | { readonly strategy: 'append';    readonly target:        string }
);

interface DAGDeriverEmbeddedDAG<TChildState extends NodeStateInterface = NodeStateInterface> {
  readonly dag:           string;
  readonly stateMapping?: {
    readonly input?:  Readonly<Partial<Record<keyof TChildState & string, string>>>;
    readonly output?: Readonly<Partial<Record<string, keyof TChildState & string>>>;
  };
  readonly outputs:       readonly string[];
}

interface DAGDeriverParallel {
  readonly members:  readonly string[];
  readonly combine:  'all-success' | 'any-success' | 'collect';
}
```

| Annotation | Purpose |
|---|---|
| `terminals` | Per-operation alternate exits. Target variant routes to a placement name (or `null` for implicit `completed`). Emit variant synthesizes a `TerminalNode` with the declared `outcome`. Multiple operations may share an `emit.name`; conflicting `outcome` values throw `DAGError`; collisions with existing operation names throw `DAGError`. |
| `fanouts` | Per-operation scatter wrapping. `source` is the dotted state-array path; `itemKey` is the metadata key the worker reads; `node` is the per-item registered node; `strategy` discriminates which gather shape is emitted (`custom`+`fanInOperation`, `partition`+`partitions`, `append`+`target`); `outcomes` lists the scatter outcome names. Partition keys must appear in `outcomes`. |
| `embeddedDAGs` | Per-operation sub-DAG body composition. Swaps the rendered placement from `SingleNode` to a `ScatterNode` with `body: { dag }` while preserving the contract's role in topology derivation. `stateMapping.input` translates to `projection`; `stateMapping.output` translates to a `map` gather. Supply `TChildState` on the generic to narrow `stateMapping.input` keys and `stateMapping.output` values at compile time. |
| `parallels` | Explicit `ParallelNode` grouping with chosen combine strategy. Without it, same-topological-depth operations auto-group with `combine: 'collect'`. Membership is exclusive across groups. |

An operation cannot appear in more than one of `fanouts`, `embeddedDAGs`, or `parallels`. Placement kind must be unambiguous.

---

## OperationContract

```ts
interface OperationContract extends OperationContractFragment {
  readonly name:         string;
  readonly hardRequired: readonly string[];
  readonly produces:     readonly string[];
  readonly outputs:      readonly string[];
}
```

Defined in `@noocodex/dagonizer/contracts`; re-exported from `@noocodex/dagonizer/derive` for convenience.

`outputs` declares every port the node can emit. `DAGDeriver` auto-wires each port to the next derived stage; `DAGDeriverAnnotations.terminals[name]` overrides individual ports per-operation. Terminals declaring a port not in the contract's `outputs` throw `DAGError` at derive time.

## OperationContractFragment

```ts
interface OperationContractFragment {
  readonly hardRequired: readonly string[];
  readonly produces:     readonly string[];
}
```

Defined in `@noocodex/dagonizer/contracts`; re-exported from `@noocodex/dagonizer/derive`. Co-located on `NodeInterface.contract` when the consumer wants the node itself to be the single source of truth for its data flow. The node's `name` and `outputs` complete the full `OperationContract` surface at registration time.

---

## ContractRegistryValidator

Static class. Registration-time checker for co-located node contracts.

```ts
class ContractRegistryValidator {
  static validate(
    contracts: readonly OperationContract[],
    onWarning: (message: string) => void,
    entrypointName?: string,
  ): void;
}
```

Surfaces two categories of drift:

- **Dangling-read.** A non-entrypoint node declares `hardRequired: ['foo.bar']` but no upstream-in-DAG node produces `'foo.bar'`. Thrown as `DAGError`. The entrypoint's `hardRequired` is external initial state and is not checked.
- **Dead-write.** A node declares `produces: ['baz']` but no downstream-in-DAG node `hardRequires` `'baz'`. Emitted as a non-fatal warning via `onWarning`.

Edge semantics match `DAGDeriver.edges` (`produces ↔ hardRequired`). Invoked automatically by `Dagonizer.registerDAG` when any registered node on the DAG carries a `contract` fragment; warnings flow to the dispatcher's `onContractWarning` hook and to `Instrumentation.contractWarning`.

---

## Related guides

- [Contract-derived flows](../guide/derive)
- [Authoring DAGs](../guide/authoring)
- [DAGBuilder](../guide/builder)
- [Visualization](../guide/visualization)
