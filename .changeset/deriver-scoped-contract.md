---
"@studnicky/dagonizer": minor
---

Move data-flow contract off NodeInterface and into deriver-scoped DerivableNodeInterface.

`NodeInterface` no longer carries a `contract` field. Nodes that participate in
DAGDeriver topology derivation implement the new `DerivableNodeInterface<TState>`,
which declares `readonly requires: readonly (keyof TState & string)[]` and
`readonly produces: readonly (keyof TState & string)[]`. The keyof constraint
enforces that declared data-flow keys are valid state field names at compile time.

`MonadicNode` no longer initialises `EMPTY_CONTRACT_FRAGMENT`. Consumers that
subclass `MonadicNode` and previously declared `override readonly contract` must
instead implement `DerivableNodeInterface` with `readonly requires` and
`readonly produces` fields. Nodes that do not participate in derivation require
no change.

`OperationContractFragmentType` and `EMPTY_CONTRACT_FRAGMENT` are removed from
all public subpath exports. `DAGDeriver.extractContracts` is now generic over
`TState`. `DagRegistrar.registerDAG` no longer runs contract validation; all
data-flow checking (dangling reads, dead writes) runs in `DAGDeriver` at derive
time. `DAGBuilder.build()` duck-type detects `DerivableNodeInterface` nodes and
validates contracts at build time. `DAGBuilder.derive` is now generic over
`TState` and requires `readonly DerivableNodeInterface<TState>[]` as input.

`ChainableType<A, B>` is rewritten to operate on `DerivableNodeInterface`
`requires`/`produces` fields; `B['requires'][number] extends A['produces'][number]`
is the compile-time proof.

`DerivableNodeInterface` is exported from `./derive` and re-exported from
`./types` and the root barrel.
