---
seeAlso:

  - text: 'Reference: Contracts — `OperationContract`'

    link: './contracts'

  - text: 'Reference: Entities — `DAG`, `ParallelNode`, `FanOutNode`'

    link: './entities'

  - text: 'Reference: Viz — `MermaidRenderer`'

    link: './viz'
    description: 'render the DAG `derive()` returned'
---

# Derive

Contract-derived flow generation. Ships through `@noocodex/dagonizer/derive`.

```ts
import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type {
  DAGDeriverAnnotations,
  DAGDeriverEmitTerminal,
  DAGDeriverFanOut,
  DAGDeriverTerminal,
  DAGDeriverOptions,
  OperationContract,
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

Operations sharing a topological depth auto-group into a `ParallelNode` with `combine: 'collect'`; use `annotations.parallels` to override the grouping or pick a different combine strategy. Each port in `contract.outputs` routes to the first successor at the next depth; `annotations.terminals` overrides individual ports. When `annotations.fanouts.<name>.strategy === 'custom'`, the referenced `fanInOperation` is emitted as a registered single-node placement alongside the fan-out so the dispatcher's `custom` fan-in reducer can resolve it.

Throws `DAGError` when `contracts` is empty, when a terminal references a port outside the contract's `outputs`, when two `emit` entries share a name but declare conflicting `outcome` values, when an `emit.name` collides with an existing operation name, when a partition outcome isn't in `outcomes`, when a parallel member appears in multiple groups, or when an operation appears in more than one of `fanouts` / `subDAGs` / `parallels`.

### `edges(contracts)`

Adjacency map. An entry `A → B` exists iff some path in `A.produces` appears in `B.hardRequired`. Useful for tooling that wants to inspect the data graph before deriving a DAG.

### `depthBuckets(contracts, edges)`

Topological depth buckets. Operations sharing a depth share a bucket. Same data the renderer uses to decide which placements to wrap in a `parallel`.

## DAGDeriverAnnotations

```ts
interface DAGDeriverAnnotations {
  readonly terminals?: Readonly<Record<string, readonly DAGDeriverTerminal[]>>;
  readonly fanouts?:   Readonly<Record<string, DAGDeriverFanOut>>;
  readonly subDAGs?:   Readonly<Record<string, DAGDeriverSubDAG>>;
  readonly parallels?: Readonly<Record<string, DAGDeriverParallel>>;
}

// DAGDeriverTerminal is a discriminated union — two variants:
type DAGDeriverTerminal =
  | { readonly outcome: string; readonly target: string | null }
  | { readonly outcome: string; readonly emit: DAGDeriverEmitTerminal };

interface DAGDeriverEmitTerminal {
  readonly name:    string;                    // placement name for the synthesized TerminalNode
  readonly outcome: 'completed' | 'failed';   // lifecycle outcome triggered when reached
}

// Fan-out is a discriminated union over the fan-in strategy.
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

interface DAGDeriverSubDAG<TChildState extends NodeStateInterface = NodeStateInterface> {
  readonly dag:           string;
  /**
   * When `TChildState` is a concrete subclass: `input` keys are narrowed to
   * `keyof TChildState & string` and `output` values are narrowed to
   * `keyof TChildState & string`. Omitting the generic (default) accepts any
   * string on both sides, preserving backward compatibility.
   */
  readonly stateMapping?: {
    /** Child-state key → parent dotted path. */
    readonly input?:  Readonly<Partial<Record<keyof TChildState & string, string>>>;
    /** Parent dotted path → child-state key. */
    readonly output?: Readonly<Partial<Record<string, keyof TChildState & string>>>;
  };
  readonly outputs:       readonly string[];
}

interface DAGDeriverParallel {
  readonly members:  readonly string[];
  readonly combine:  'all-success' | 'any-success' | 'collect';
}
```

- `terminals` — per-operation alternate exits. Two variants: the **target variant** (`target: null` to terminate with implicit `completed`, or `target: string` to route to a named placement); the **emit variant** (`emit: { name, outcome }` to synthesize a `TerminalNode` placement and route the port to it, ending the run with the declared `outcome`). Multiple operations may declare the same `emit.name` — the deriver deduplicates. Conflicting `outcome` values for the same `emit.name` throw `DAGError`. An `emit.name` colliding with an existing operation name throws `DAGError`.
- `fanouts` — per-operation fan-out wrapping. `source` is the dotted state-array path; `itemKey` is the metadata key the worker reads; `node` is the per-item registered node; `strategy` discriminates which fan-in shape gets emitted (`custom`+`fanInOperation`, `partition`+`partitions`, or `append`+`target`); `outcomes` lists the fan-out outcome names. Partition keys must appear in `outcomes` — out-of-band keys throw `DAGError` at derive time.
- `subDAGs` — per-operation sub-DAG composition. Swaps the rendered placement from `SingleNode` to `DeepDAGNode` while preserving the contract's role in topology derivation. `dag` is the registered child DAG name; `outputs` is the port set the deep-DAG can route on (auto-wired to the next derived stage, with `terminals` overriding); `stateMapping` is forwarded verbatim to the rendered placement. Supply `TChildState` on the `DAGDeriverSubDAG<TChildState>` generic to narrow `stateMapping.input` keys and `stateMapping.output` values to keys that exist on the child state at compile time; omitting the generic accepts any string (backward compatible).
- `parallels` — explicit `ParallelNode` grouping with chosen combine strategy. Without it, same-topological-depth operations auto-group with `combine: 'collect'`. With it, the named group forces members into one `ParallelNode` with the consumer's chosen combine. Membership is exclusive across groups.
- An operation cannot appear in more than one of `fanouts` / `subDAGs` / `parallels` — placement kind must be unambiguous.

## OperationContract

```ts
interface OperationContract {
  readonly name:         string;
  readonly hardRequired: readonly string[];
  readonly produces:     readonly string[];
  readonly outputs:      readonly string[];
}
```

Defined in `@noocodex/dagonizer/contracts`; re-exported from `@noocodex/dagonizer/derive` for convenience.

`outputs` declares every port the node can emit. `DAGDeriver` auto-wires each port to the next derived stage; `DAGDeriverAnnotations.terminals[name]` overrides individual ports per-operation. Terminals declaring a port not in the contract's `outputs` throw `DAGError` at derive time.
## Related guides

- [Contract-derived flows](../guide/derive)
- [Authoring DAGs](../guide/authoring) — when to use DAGDeriver vs DAGBuilder vs raw DAG literals
- [DAGBuilder](../guide/builder) — imperative authoring for deterministic / ETL workflows
- [Visualization](../guide/visualization)
