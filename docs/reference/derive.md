---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`OperationContractType`, `OperationContractFragmentType`'
  - text: 'Reference: Entities'
    link: './entities'
    description: '`DAG`, `ScatterNode`'
  - text: 'Reference: Viz'
    link: './viz'
    description: 'render the DAG `derive()` returned'
---

# Derive

Contract-derived flow generation. Ships through `@studnicky/dagonizer/derive`.

```ts twoslash
import { DAGDeriver, ContractRegistryValidator } from '@studnicky/dagonizer/derive';
import type {
  DAGDeriverAnnotationsType,
  DAGDeriverEmitTerminalType,
  DAGDeriverEmbeddedDAGType,
  DAGDeriverScatterType,
  DAGDeriverTerminalType,
  DAGDeriverOptionsType,
} from '@studnicky/dagonizer/derive';
import type {
  OperationContractType,
  OperationContractFragmentType,
} from '@studnicky/dagonizer/contracts';
```

## DAGDeriver

Static class.

```ts twoslash
import type { DAGDeriverOptionsType } from '@studnicky/dagonizer/derive';
import type { DAGType } from '@studnicky/dagonizer';
import type { NodeInterface, OperationContractType } from '@studnicky/dagonizer/contracts';
// ---cut---
declare class DAGDeriver {
  static derive(opts: DAGDeriverOptionsType): DAGType;
  static extractContracts(nodes: readonly NodeInterface[]): OperationContractType[];
  static edges(contracts: readonly OperationContractType[]): ReadonlyMap<string, ReadonlySet<string>>;
  static depthBuckets(
    contracts: readonly OperationContractType[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
  ): readonly (readonly string[])[];
}
```

### `derive(opts)`

Build a `DAG` from a node registry plus declared annotations. Each node co-locates its own `contract` field (`{ hardRequired, produces }`); the node's `name` and `outputs` complete the full `OperationContractType` surface. At least one node must declare a `contract`.

```ts twoslash
import type { DAGDeriverAnnotationsType } from '@studnicky/dagonizer/derive';
import type { NodeInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
interface DAGDeriverOptionsType {
  name: string;
  version: string;
  entrypoint: string;
  /** Node registry. Each node with a co-located `contract` participates in topology derivation. */
  nodes: NodeInterface[];
  annotations?: DAGDeriverAnnotationsType;
}
```

Each port in `node.outputs` routes to the first successor at the next depth; `annotations.terminals` overrides individual ports. Operations at the same topological depth that need concurrent execution are expressed via `annotations.scatters` (scatter over a descriptor source with a dispatching body). When `annotations.scatters.<name>.strategy === 'custom'`, the referenced `customNode` is emitted as a registered single-node placement alongside the scatter so the dispatcher's `custom` gather strategy can resolve it.

Throws `DAGError` when no node carries a `contract` field, when a terminal references a port outside the node's `outputs`, when two `emit` entries share a name but declare conflicting `outcome` values, when an `emit.name` collides with an existing operation name, when a partition outcome isn't in `outcomes`, or when an operation appears in more than one of `scatters` / `embeddedDAGs`.

### `extractContracts(nodes)`

Project contract-bearing nodes from a node registry into `OperationContractType[]`. Nodes without a `contract` field are silently skipped. The node's own `name` and `outputs` join the fragment's `hardRequired` and `produces` to form the full `OperationContractType` surface. `DAGDeriver.derive` calls this internally; expose it for tooling that needs to inspect the contract projection before or after derivation.

### `edges(contracts)`

Adjacency map. An entry `A → B` exists iff some path in `A.produces` appears in `B.hardRequired`. Useful for tooling that wants to inspect the data graph before deriving a DAG.

### `depthBuckets(contracts, edges)`

Topological depth buckets. Operations sharing a depth share a bucket. Useful for tooling that needs to inspect which operations are topologically concurrent before or after derivation.

---

## DAGDeriverAnnotationsType

```ts twoslash
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
interface DAGDeriverEmitTerminalType {
  name:    string;                    // placement name for the synthesized TerminalNode
  outcome: 'completed' | 'failed';   // lifecycle outcome triggered when reached
}

type DAGDeriverTerminalType =
  | { outcome: string; target: string }
  | { outcome: string; emit: DAGDeriverEmitTerminalType };

type DAGDeriverScatterType = {
  source:      string;
  itemKey:     string;
  node:        string;
  concurrency: number;
  outcomes:    string[];
} & (
  | { strategy: 'custom';    customNode: string;
      partitions?: never;    target?: never }
  | { strategy: 'partition'; partitions: Record<string, string>;
      customNode?: never;    target?: never }
  | { strategy: 'append';    target: string;
      customNode?: never;    partitions?: never }
);

type ChildKey<T extends NodeStateInterface> =
  NodeStateInterface extends T ? string : keyof T & string;

interface DAGDeriverEmbeddedDAGType<TChildState extends NodeStateInterface = NodeStateInterface> {
  dag:           string;
  stateMapping?: {
    input?:  Partial<Record<ChildKey<TChildState>, string>>;
    output?: Partial<Record<string, ChildKey<TChildState>>>;
  };
  outputs:       string[];
}

interface DAGDeriverAnnotationsType {
  terminals?:   Record<string, DAGDeriverTerminalType[]>;
  scatters?:    Record<string, DAGDeriverScatterType>;
  embeddedDAGs?: Record<string, DAGDeriverEmbeddedDAGType>;
}
```

| Annotation | Purpose |
|---|---|
| `terminals` | Per-operation alternate exits. Target variant (`target: string`) routes to a named existing placement. Emit variant synthesizes a `TerminalNode` with the declared `outcome`; this is the only way to end a flow outcome. Multiple operations may share an `emit.name`; conflicting `outcome` values throw `DAGError`; collisions with existing operation names throw `DAGError`. |
| `scatters` | Per-operation scatter wrapping. `source` is the dotted state-array path; `itemKey` is the metadata key the clone reads; `node` is the per-item body node; `strategy` discriminates which gather shape is emitted (`custom`+`customNode`, `partition`+`partitions`, `append`+`target`); `outcomes` lists the scatter outcome names. Partition keys must appear in `outcomes`. |
| `embeddedDAGs` | Per-operation nested-DAG composition. Swaps the rendered placement from `SingleNode` to an `EmbeddedDAGNode` while preserving the contract's role in topology derivation. `stateMapping.input` seeds the child state before execution; `stateMapping.output` copies child fields back to the parent after completion. Supply `TChildState` on the generic to narrow `stateMapping.input` keys and `stateMapping.output` values at compile time. |

An operation cannot appear in more than one of `scatters` or `embeddedDAGs`. Placement kind must be unambiguous.

---

## OperationContractType

```ts twoslash
import type { OperationContractFragmentType } from '@studnicky/dagonizer/contracts';
// ---cut---
interface OperationContractType extends OperationContractFragmentType {
  name:         string;
  hardRequired: string[];
  produces:     string[];
  outputs:      string[];
}
```

Defined in `@studnicky/dagonizer/contracts`.

`outputs` declares every port the node can emit. `DAGDeriver` auto-wires each port to the next derived stage; `DAGDeriverAnnotationsType.terminals[name]` overrides individual ports per-operation. Terminals declaring a port not in the contract's `outputs` throw `DAGError` at derive time.

## OperationContractFragmentType

```ts twoslash
interface OperationContractFragmentType {
  hardRequired: string[];
  produces:     string[];
}
```

Defined in `@studnicky/dagonizer/contracts`. Co-located on `NodeInterface.contract` when the consumer wants the node itself to be the single source of truth for its data flow. The node's `name` and `outputs` complete the full `OperationContractType` surface at registration time.

---

## ContractRegistryValidator

Static class. Registration-time checker for co-located node contracts.

```ts twoslash
import type { OperationContractType } from '@studnicky/dagonizer/contracts';
// ---cut---
declare class ContractRegistryValidator {
  static validate(
    contracts: readonly OperationContractType[],
    options?: { entrypointName: string },
  ): void;
}
```

Surfaces two categories of drift, both fatal:

- **Dangling-read.** A non-entrypoint node declares `hardRequired: ['foo.bar']` but no upstream-in-DAG node produces `'foo.bar'`. Thrown as `DAGError`. The entrypoint's `hardRequired` is external initial state and is not checked.
- **Dead-write.** A node declares `produces: ['baz']` but no downstream-in-DAG node `hardRequires` `'baz'`. Thrown as `DAGError`.

Edge semantics match `DAGDeriver.edges` (`produces ↔ hardRequired`). Invoked automatically by `Dagonizer.registerDAG` when any registered node on the DAG carries a `contract` fragment; a drift in either category throws before the DAG registers.

---

## Related guides

- [Contract-derived flows](../guide/derive)
- [Authoring DAGs](../guide/authoring)
- [DAGBuilder](../guide/builder)
- [Visualization](../guide/visualization)
