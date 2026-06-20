---
"@studnicky/dagonizer": minor
---

The `DAGDeriver` contract-derived flow generation is removed along with `DerivableNodeInterface`, `ChainableType`, `OperationContractType`, `ContractRegistryValidator`, and the `./derive` subpath export. `DAGBuilder` is the single, explicitly-wired, compile-checked way to construct a DAG.
