---
seeAlso:
  - text: 'Reference: Entities'
    link: './entities'
    description: 'JSON Schema sources for every placement'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: '`NodeInterface`, the contract a placement references'
  - text: 'Reference: Core'
    link: './core'
    description: '`ParallelCombiner`, `GatherStrategy`, `OutcomeReducer`'
---

# Nodes

Placement types: the appearances of nodes inside a `DAG`. Each placement is a discriminated union member keyed by `@type`, ships with a JSON Schema in `@noocodex/dagonizer/entities`, and resolves to a typed TS shape via `json-schema-to-ts`.

A registered `NodeInterface` (the consumer-implemented unit of work) is referenced from a placement by name. A "node" is the unit of work. A "placement" is its appearance inside a `DAG`. `TerminalNode` is placement-only and references no registered node.

| Placement `@type` | Schema | TS type | Purpose |
|---|---|---|---|
| `SingleNode` | `SingleNodeSchema` | `SingleNode`, `SingleNodePlacementInterface<TOutput>` | Run one registered node; route per output |
| `ParallelNode` | `ParallelNodeSchema` | `ParallelNode` | Run a group of single-node placements concurrently; combine outputs |
| `ScatterNode` | `ScatterNodeSchema` | `ScatterNode` | Isolate one clone per source-array item, run a node body, gather produced state, route on aggregate outcome |
| `EmbeddedDAGNode` | `EmbeddedDAGNodeSchema` | `EmbeddedDAGNode` | Invoke a registered sub-DAG exactly once (cardinality 1); route on the child's terminal outcome |
| `TerminalNode` | `TerminalNodeSchema` | `TerminalNode`, `TerminalNodePlacementInterface` | End the flow with an explicit `outcome` |
| `PhaseNode` | `PhaseNodeSchema` | `PhaseNode`, `PhaseNodePlacementInterface` | Pre/post lifecycle hook running outside the main loop |

Every schema's `$id` is `https://noocodex.dev/schemas/dagonizer/<TypeName>`.

---

## `SingleNode`

```ts
import { SingleNodeSchema } from '@noocodex/dagonizer/entities';
import type { SingleNode, SingleNodePlacementInterface } from '@noocodex/dagonizer/entities';
```

```json
{
  "@id":     "urn:noocodex:dag:my-dag/node/greet",
  "@type":   "SingleNode",
  "name":    "greet",
  "node":    "greet",
  "outputs": { "success": "next-node", "error": null }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'SingleNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name (unique within the DAG) |
| `node` | `string` | yes | Registered `NodeInterface.name` to invoke |
| `outputs` | `Record<string, string \| null>` | yes | Output port to next-placement name (or `null` to terminate the path) |

`SingleNodePlacementInterface<TOutput extends string>` narrows `outputs` to `Record<TOutput, null | string>` for compile-time exhaustiveness when `TOutput` is a literal union.

---

## `ParallelNode`

```ts
import { ParallelNodeSchema } from '@noocodex/dagonizer/entities';
import type { ParallelNode } from '@noocodex/dagonizer/entities';
```

```json
{
  "@id":     "urn:noocodex:dag:my-dag/node/probe-group",
  "@type":   "ParallelNode",
  "name":    "probe-group",
  "nodes":   ["probe-a", "probe-b"],
  "combine": "all-success",
  "outputs": { "success": "merge", "error": null }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'ParallelNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name |
| `nodes` | `readonly string[]` | yes | Non-empty list of `SingleNode` placement names within the same DAG |
| `combine` | `'all-success' \| 'any-success' \| 'collect'` | yes | Built-in combiner, or any name registered via `ParallelCombiners.register` |
| `outputs` | `Record<string, string \| null>` | yes | Routes for the combined output |

The group runs every member via `Promise.all`. The dispatcher resolves the combiner by `ParallelCombiners.resolve(combine)` and yields a group result after the intermediates.

---

## `ScatterNode`

```ts
import { ScatterNodeSchema } from '@noocodex/dagonizer/entities';
import type { ScatterNode } from '@noocodex/dagonizer/entities';
```

Generate-collect pattern (one clone per source-array item):

```json
{
  "@id":         "urn:noocodex:dag:my-dag/node/generate",
  "@type":       "ScatterNode",
  "name":        "generate",
  "body":        { "node": "generate-worker" },
  "source":      "providers",
  "itemKey":     "currentItem",
  "concurrency": 4,
  "gather":      { "strategy": "map", "mapping": { "candidate": "candidates" } },
  "outputs":     { "all-success": "select", "partial": "select", "all-error": null, "empty": null }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'ScatterNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name |
| `body` | `{ node: string }` | yes | Body: registered node name |
| `outputs` | `Record<string, string \| null>` | yes | Routes for the reduced outcome |
| `source` | `string` | yes | Dotted state-array path. One clone runs per item. |
| `itemKey` | `string` | no | Metadata key bound to the current item per clone (default `'currentItem'`). |
| `concurrency` | `number` | no | Batch size for `Promise.all` (default: source length). |
| `stateMapping` | `{ input?: Record<childKey, parentPath> }` | no | Seeds each clone: `input` copies parent fields into the clone before the body runs. Authored via the `inputs` builder option. |
| `gather` | `GatherConfig` | no | How produced clone state merges back into the parent. |
| `reducer` | `string` | no | Outcome reducer name. Defaults to `'aggregate'`. |

`GatherConfig` is documented under [Gather configuration](#gather-configuration) below.

Per-item resume bookkeeping is persisted under the reserved metadata key `SCATTER_PROGRESS_KEY` so a checkpoint-resume cycle skips clones completed in the prior run.

---

## `EmbeddedDAGNode`

```ts
import { EmbeddedDAGNodeSchema } from '@noocodex/dagonizer/entities';
import type { EmbeddedDAGNode } from '@noocodex/dagonizer/entities';
```

```json
{
  "@id":     "urn:noocodex:dag:parent/node/run-child",
  "@type":   "EmbeddedDAGNode",
  "name":    "run-child",
  "dagName": "child-pipeline",
  "outputs": { "success": "next-step", "error": null },
  "stateMapping": {
    "input":  { "payload": "user.name" },
    "output": { "user.result": "result" }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'EmbeddedDAGNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name |
| `dagName` | `string` | yes | Registered sub-DAG name to invoke (cardinality 1) |
| `outputs` | `Record<'success' \| 'error', string \| null>` | yes | Routes for the child's terminal outcome |
| `stateMapping` | `{ input?: Record<string, string>; output?: Record<string, string> }` | no | `input` copies parent fields into the child before it runs (child-key ← parent-path); `output` copies child fields back into the parent after it completes (parent-path ← child-key). |

`EmbeddedDAGNode` invokes a registered sub-DAG exactly once (cardinality 1). It is the embedding primitive: the parent flow suspends, the child DAG runs to completion in an isolated state, and the parent routes on the child's terminal outcome (`success` when the child lifecycle is `completed`; `error` when `failed`). Authored via `.embeddedDAG(name, dagName, routes, { inputs, outputs })` on `DAGBuilder`, or via the `embeddedDAGs` annotation on `DAGDeriver.derive`.

---

## `TerminalNode`

```ts
import { TerminalNodeSchema } from '@noocodex/dagonizer/entities';
import type { TerminalNode, TerminalNodePlacementInterface } from '@noocodex/dagonizer/entities';
```

```json
{
  "@id":     "urn:noocodex:dag:my-dag/node/done-ok",
  "@type":   "TerminalNode",
  "name":    "done-ok",
  "outcome": "completed"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'TerminalNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name |
| `outcome` | `'completed' \| 'failed'` | yes | Lifecycle outcome to mark on exit |

No `outputs` map. Placement-only (no backing `NodeInterface`). On reach, the engine fires `state.markCompleted()` or `state.markFailed(...)` and ends the loop. The placement-level `outcome` surfaces on `ExecutionResultInterface.terminalOutcome`.

---

## `PhaseNode`

```ts
import { PhaseNodeSchema } from '@noocodex/dagonizer/entities';
import type { PhaseNode, PhaseNodePlacementInterface } from '@noocodex/dagonizer/entities';
```

```json
{
  "@id":   "urn:noocodex:dag:my-dag/node/seed-cache",
  "@type": "PhaseNode",
  "name":  "seed-cache",
  "node":  "seed-cache",
  "phase": "pre"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'PhaseNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name |
| `node` | `string` | yes | Registered `NodeInterface.name` invoked at the phase boundary |
| `phase` | `'pre' \| 'post'` | yes | Run before the entrypoint or after the main loop drains |

No `outputs` map. Pre-phase placements run in DAG declaration order before the entrypoint; a thrown error aborts the run (lifecycle becomes `failed`, the main loop never executes). Post-phase placements run in declaration order on every exit path (completion, abort, timeout, terminal-failed, node throw); a thrown error is collected as a warning (code `POST_PHASE_FAILED`) and does not change the already-set lifecycle. Phase placements surface via `Instrumentation.phaseEnter` / `phaseExit`.

---

## Gather configuration

`GatherConfig` is referenced from `ScatterNode.gather` and is also exported as a standalone schema and type.

```ts
import { GatherConfigSchema } from '@noocodex/dagonizer/entities';
import type { GatherConfig } from '@noocodex/dagonizer/entities';
```

```ts
interface GatherConfig {
  strategy: 'map' | 'append' | 'partition' | 'custom';
  mapping?:    Record<string, string>;   // map: clone path → parent path
  field?:      string;                   // append/partition: clone field to read (omit ⇒ source item)
  target?:     string;                   // append: parent array path
  partitions?: Record<string, string>;   // partition: output token → parent array path
  customNode?: string;                   // custom: registered node name
}
```

| Strategy | Key fields | Behaviour |
|---|---|---|
| `map` | `mapping` (clone path → parent path) | One clone ⇒ scalar set; N clones ⇒ index-ordered array append. This is the generate-collect pattern. |
| `append` | `target` (dotted path), optional `field` | Flatten the clone `field` (or source item) across all clones into `target`. |
| `partition` | `partitions: Record<output, path>`, optional `field` | Bucket clones by their output token; write each group to its dedicated path. |
| `custom` | `customNode` (registered name) | Stage per-clone records under `state.metadata.gatherResults` and dispatch the named node. |

Strategies are pluggable: register a new one with `GatherStrategies.register(strategy)`. See [Reference: Core](./core).

---

## Related guides

- [DAGBuilder](../guide/builder)
- [Lifecycle phases](../guide/lifecycle-phases)
- [Terminal placements](../examples/09-terminals)
- [Subclassing state](../guide/subclassing)
