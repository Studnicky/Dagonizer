---
seeAlso:
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`OperationContract`, `OperationContractFragment`'
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
  DAGDeriverAnnotations,
  DAGDeriverEmitTerminal,
  DAGDeriverEmbeddedDAG,
  DAGDeriverScatter,
  DAGDeriverTerminal,
  DAGDeriverOptions,
} from '@studnicky/dagonizer/derive';
import type {
  OperationContract,
  OperationContractFragment,
} from '@studnicky/dagonizer/contracts';
```

## DAGDeriver

Static class.

```ts twoslash
import type { DAGDeriverOptions } from '@studnicky/dagonizer/derive';
import type { DAG } from '@studnicky/dagonizer';
import type { NodeInterface, OperationContract } from '@studnicky/dagonizer/contracts';
// ---cut---
declare class DAGDeriver {
  static derive(opts: DAGDeriverOptions): DAG;
  static extractContracts(nodes: readonly NodeInterface[]): OperationContract[];
  static edges(contracts: readonly OperationContract[]): ReadonlyMap<string, ReadonlySet<string>>;
  static depthBuckets(
    contracts: readonly OperationContract[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
  ): readonly (readonly string[])[];
}
```

### `derive(opts)`

Build a `DAG` from a node registry plus declared annotations. Each node co-locates its own `contract` field (`{ hardRequired, produces }`); the node's `name` and `outputs` complete the full `OperationContract` surface. At least one node must declare a `contract`.

```ts twoslash
import type { DAGDeriverAnnotations } from '@studnicky/dagonizer/derive';
import type { NodeInterface } from '@studnicky/dagonizer/contracts';
// ---cut---
interface DAGDeriverOptions {
  name: string;
  version: string;
  entrypoint: string;
  /** Node registry. Each node with a co-located `contract` participates in topology derivation. */
  nodes: NodeInterface[];
  annotations?: DAGDeriverAnnotations;
}
```

Each port in `node.outputs` routes to the first successor at the next depth; `annotations.terminals` overrides individual ports. Operations at the same topological depth that need concurrent execution are expressed via `annotations.scatters` (scatter over a descriptor source with a dispatching body). When `annotations.scatters.<name>.strategy === 'custom'`, the referenced `customNode` is emitted as a registered single-node placement alongside the scatter so the dispatcher's `custom` gather strategy can resolve it.

Throws `DAGError` when no node carries a `contract` field, when a terminal references a port outside the node's `outputs`, when two `emit` entries share a name but declare conflicting `outcome` values, when an `emit.name` collides with an existing operation name, when a partition outcome isn't in `outcomes`, or when an operation appears in more than one of `scatters` / `embeddedDAGs`.

### `extractContracts(nodes)`

Project contract-bearing nodes from a node registry into `OperationContract[]`. Nodes without a `contract` field are silently skipped. The node's own `name` and `outputs` join the fragment's `hardRequired` and `produces` to form the full `OperationContract` surface. `DAGDeriver.derive` calls this internally; expose it for tooling that needs to inspect the contract projection before or after derivation.

### `edges(contracts)`

Adjacency map. An entry `A → B` exists iff some path in `A.produces` appears in `B.hardRequired`. Useful for tooling that wants to inspect the data graph before deriving a DAG.

### `depthBuckets(contracts, edges)`

Topological depth buckets. Operations sharing a depth share a bucket. Useful for tooling that needs to inspect which operations are topologically concurrent before or after derivation.

---

## DAGDeriverAnnotations

```ts twoslash
import type { NodeStateInterface } from '@studnicky/dagonizer';
// ---cut---
interface DAGDeriverEmitTerminal {
  name:    string;                    // placement name for the synthesized TerminalNode
  outcome: 'completed' | 'failed';   // lifecycle outcome triggered when reached
}

type DAGDeriverTerminal =
  | { outcome: string; target: string }
  | { outcome: string; emit: DAGDeriverEmitTerminal };

type DAGDeriverScatter = {
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

interface DAGDeriverEmbeddedDAG<TChildState extends NodeStateInterface = NodeStateInterface> {
  dag:           string;
  stateMapping?: {
    input?:  Partial<Record<ChildKey<TChildState>, string>>;
    output?: Partial<Record<string, ChildKey<TChildState>>>;
  };
  outputs:       string[];
}

interface DAGDeriverAnnotations {
  terminals?:   Record<string, DAGDeriverTerminal[]>;
  scatters?:    Record<string, DAGDeriverScatter>;
  embeddedDAGs?: Record<string, DAGDeriverEmbeddedDAG>;
}
```

| Annotation | Purpose |
|---|---|
| `terminals` | Per-operation alternate exits. Target variant (`target: string`) routes to a named existing placement. Emit variant synthesizes a `TerminalNode` with the declared `outcome`; this is the only way to end a flow outcome. Multiple operations may share an `emit.name`; conflicting `outcome` values throw `DAGError`; collisions with existing operation names throw `DAGError`. |
| `scatters` | Per-operation scatter wrapping. `source` is the dotted state-array path; `itemKey` is the metadata key the clone reads; `node` is the per-item body node; `strategy` discriminates which gather shape is emitted (`custom`+`customNode`, `partition`+`partitions`, `append`+`target`); `outcomes` lists the scatter outcome names. Partition keys must appear in `outcomes`. |
| `embeddedDAGs` | Per-operation nested-DAG composition. Swaps the rendered placement from `SingleNode` to an `EmbeddedDAGNode` while preserving the contract's role in topology derivation. `stateMapping.input` seeds the child state before execution; `stateMapping.output` copies child fields back to the parent after completion. Supply `TChildState` on the generic to narrow `stateMapping.input` keys and `stateMapping.output` values at compile time. |

An operation cannot appear in more than one of `scatters` or `embeddedDAGs`. Placement kind must be unambiguous.

---

## OperationContract

```ts twoslash
import type { OperationContractFragment } from '@studnicky/dagonizer/contracts';
// ---cut---
interface OperationContract extends OperationContractFragment {
  name:         string;
  hardRequired: string[];
  produces:     string[];
  outputs:      string[];
}
```

Defined in `@studnicky/dagonizer/contracts`.

`outputs` declares every port the node can emit. `DAGDeriver` auto-wires each port to the next derived stage; `DAGDeriverAnnotations.terminals[name]` overrides individual ports per-operation. Terminals declaring a port not in the contract's `outputs` throw `DAGError` at derive time.

## OperationContractFragment

```ts twoslash
interface OperationContractFragment {
  hardRequired: string[];
  produces:     string[];
}
```

Defined in `@studnicky/dagonizer/contracts`. Co-located on `NodeInterface.contract` when the consumer wants the node itself to be the single source of truth for its data flow. The node's `name` and `outputs` complete the full `OperationContract` surface at registration time.

---

## ContractRegistryValidator

Static class. Registration-time checker for co-located node contracts.

```ts twoslash
import type { OperationContract } from '@studnicky/dagonizer/contracts';
// ---cut---
declare class ContractRegistryValidator {
  static validate(
    contracts: readonly OperationContract[],
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
