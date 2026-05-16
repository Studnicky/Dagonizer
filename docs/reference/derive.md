# Derive

Contract-derived flow generation. Ships through `@noocodex/dagonizer/derive`.

```ts
import { FlowDeriver } from '@noocodex/dagonizer/derive';
import type {
  FlowAnnotations,
  FlowFanOut,
  FlowTerminal,
  FlowDeriverOptions,
  OperationContract,
} from '@noocodex/dagonizer/derive';
```

## FlowDeriver

Static class.

```ts
class FlowDeriver {
  static derive(opts: FlowDeriverOptions): DAG;
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
interface FlowDeriverOptions {
  readonly name: string;
  readonly version: string;
  readonly entrypoint: string;
  readonly contracts: readonly OperationContract[];
  readonly annotations?: FlowAnnotations;
}
```

Operations sharing a topological depth are emitted as a `parallel` placement that fires them concurrently. The `success` route on each linear placement targets the first successor at the next depth. Operations named in `annotations.fanouts.<name>.fanInOperation` are emitted as registered single-node placements (so the `custom` fan-in strategy can resolve them).

Throws `DAGError` when `contracts` is empty.

### `edges(contracts)`

Adjacency map. An entry `A → B` exists iff some path in `A.produces` appears in `B.hardRequired`. Useful for tooling that wants to inspect the data graph before deriving a DAG.

### `depthBuckets(contracts, edges)`

Topological depth buckets. Operations sharing a depth share a bucket. Same data the renderer uses to decide which placements to wrap in a `parallel`.

## FlowAnnotations

```ts
interface FlowAnnotations {
  readonly terminals?: Readonly<Record<string, readonly FlowTerminal[]>>;
  readonly fanouts?: Readonly<Record<string, FlowFanOut>>;
}

interface FlowTerminal {
  readonly outcome: string;
  readonly target: string | null;
}

interface FlowFanOut {
  readonly source: string;
  readonly itemKey: string;
  readonly concurrency?: number;
  readonly fanInOperation: string;
  readonly outcomes: readonly string[];
}
```

`terminals` declares per-operation alternate exits (route to `null` to terminate, or to a named operation). `fanouts` declares per-operation fan-out wrapping (`source` is the dotted state-array path; `itemKey` is the metadata key the worker reads; `fanInOperation` is the registered node invoked through the `custom` fan-in strategy; `outcomes` lists the fan-out outcome names — typically `'all-success' | 'partial' | 'all-error' | 'empty'`).

## OperationContract

```ts
interface OperationContract {
  readonly name: string;
  readonly hardRequired: readonly string[];
  readonly produces: readonly string[];
}
```

Defined in `@noocodex/dagonizer/contracts`; re-exported from `@noocodex/dagonizer/derive` for convenience.

## See also

- [Reference: Contracts — `OperationContract`](./contracts)
- [Reference: Entities — `DAG`, `ParallelNode`, `FanOutNode`](./entities)
- [Reference: Viz — `MermaidRenderer`](./viz) — render the DAG `derive()` returned

## Related guides

- [Contract-derived flows](../guide/derive)
- [DAGBuilder](../guide/builder) — the imperative alternative
- [Visualization](../guide/visualization)
