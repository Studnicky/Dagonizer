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
    description: '`GatherStrategy`, `OutcomeReducer`'
---

# Nodes

Placement types: the appearances of nodes inside a `DAG`. Each placement is a discriminated union member keyed by `@type`, ships with a JSON Schema in `@noocodex/dagonizer/entities`, and resolves to a typed TS shape via `json-schema-to-ts`.

A registered `NodeInterface` (the consumer-implemented unit of work) is referenced from a placement by name. A "node" is the unit of work. A "placement" is its appearance inside a `DAG`. `TerminalNode` is placement-only and references no registered node.

| Placement `@type` | Schema | TS type | Purpose |
|---|---|---|---|
| `SingleNode` | `SingleNodeSchema` | `SingleNode`, `SingleNodePlacementInterface<TOutput>` | Run one registered node; route per output |
| `ScatterNode` | `ScatterNodeSchema` | `ScatterNode` | Isolate one clone per source-array item, run a body, fold clone state back through a required `gather`, route on aggregate outcome |
| `EmbeddedDAGNode` | `EmbeddedDAGNodeSchema` | `EmbeddedDAGNode` | Invoke a registered sub-DAG exactly once (cardinality 1); route on the child's terminal outcome |
| `TerminalNode` | `TerminalNodeSchema` | `TerminalNode` | End the flow with an explicit `outcome` |
| `PhaseNode` | `PhaseNodeSchema` | `PhaseNode` | Pre/post lifecycle hook running outside the main loop |

Every schema's `$id` is `https://noocodex.dev/schemas/dagonizer/<TypeName>`.

---

## `SingleNode`

```ts twoslash
import { SingleNodeSchema } from '@noocodex/dagonizer/entities';
import type { SingleNode, SingleNodePlacementInterface } from '@noocodex/dagonizer/entities';
// ---cut---
declare const placement: SingleNode;
const name: string = placement.name;
const outputs: Record<string, string> = placement.outputs;
export {};
```

```json
{
  "@id":     "urn:noocodex:dag:my-dag/node/greet",
  "@type":   "SingleNode",
  "name":    "greet",
  "node":    "greet",
  "outputs": { "success": "next-node", "error": "done-error" }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'SingleNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name (unique within the DAG) |
| `node` | `string` | yes | Registered `NodeInterface.name` to invoke |
| `outputs` | `Record<string, string>` | yes | Output port to next-placement name. All outputs must route to a named placement. |

`SingleNodePlacementInterface<TOutput extends string>` narrows `outputs` to `Record<TOutput, string>` for compile-time exhaustiveness when `TOutput` is a literal union.

---

## `ScatterNode`

```ts twoslash
import { ScatterNodeSchema } from '@noocodex/dagonizer/entities';
import type { ScatterNode } from '@noocodex/dagonizer/entities';
// ---cut---
declare const placement: ScatterNode;
const name: string = placement.name;
const source: string = placement.source;
export {};
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
| `body` | `{ node: string } \| { dag: string }` | yes | Body: `{ node }` dispatches one registered node per clone; `{ dag }` runs a full registered sub-DAG per clone (supports the `container` key for isolate dispatch). |
| `outputs` | `Record<string, string \| null>` | yes | Routes for the reduced outcome |
| `source` | `string` | yes | Dotted state-array path. One clone runs per item. |
| `itemKey` | `string` | no | Metadata key bound to the current item per clone (default `'currentItem'`). |
| `concurrency` | `number` | no | Batch size for `Promise.all` (default: source length). |
| `stateMapping` | `{ input?: Record<childKey, parentPath> }` | no | Seeds each clone: `input` copies parent fields into the clone before the body runs. Authored via the `inputs` builder option. |
| `gather` | `GatherConfig` | **yes** | How produced clone state merges back into the parent. Use `{ strategy: 'discard' }` for side-effect-only fan-outs. |
| `reducer` | `string` | no | Outcome reducer name. Defaults to `'aggregate'`. Built-in: `'aggregate'`, `'terminal'`, `'all-success'`, `'any-success'`. Custom reducers registered via `OutcomeReducers.register` are referenceable by name. |
| `container` | `string` | no | Logical container role name for `{ dag }` bodies only. Bound at construction via `DagonizerOptionsInterface.containers`. An unbound role falls back to in-process and fires `onContractWarning`. Setting `container` on a `{ node }` body is a validation error. |

`GatherConfig` is documented under [Gather configuration](#gather-configuration) below.

Per-item resume bookkeeping is persisted under the reserved metadata key `SCATTER_PROGRESS_KEY` so a checkpoint-resume cycle skips clones completed in the prior run.

---

## `EmbeddedDAGNode`

```ts twoslash
import { EmbeddedDAGNodeSchema } from '@noocodex/dagonizer/entities';
import type { EmbeddedDAGNode } from '@noocodex/dagonizer/entities';
// ---cut---
declare const placement: EmbeddedDAGNode;
const name: string = placement.name;
const dag: string = placement.dag;
export {};
```

```json
{
  "@id":     "urn:noocodex:dag:parent/node/run-child",
  "@type":   "EmbeddedDAGNode",
  "name":    "run-child",
  "dag":     "child-pipeline",
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
| `dag` | `string` | yes | Registered sub-DAG name to invoke (cardinality 1) |
| `outputs` | `Record<'success' \| 'error', string \| null>` | yes | Routes for the child's terminal outcome |
| `stateMapping` | `{ input?: Record<string, string>; output?: Record<string, string> }` | no | `input` copies parent fields into the child before it runs (child-key ← parent-path); `output` copies child fields back into the parent after it completes (parent-path ← child-key). |

`EmbeddedDAGNode` invokes a registered sub-DAG exactly once (cardinality 1). It is the embedding primitive: the parent flow suspends, the child DAG runs to completion in an isolated state, and the parent routes on the child's terminal outcome (`success` when the child lifecycle is `completed`; `error` when `failed`). Authored via `.embeddedDAG(name, dagName, routes, { inputs, outputs })` on `DAGBuilder`, or via the `embeddedDAGs` annotation on `DAGDeriver.derive`.

---

## `TerminalNode`

```ts twoslash
import { TerminalNodeSchema } from '@noocodex/dagonizer/entities';
import type { TerminalNode } from '@noocodex/dagonizer/entities';
// ---cut---
declare const placement: TerminalNode;
const name: string = placement.name;
const outcome: 'completed' | 'failed' = placement.outcome;
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

```ts twoslash
import { PhaseNodeSchema } from '@noocodex/dagonizer/entities';
import type { PhaseNode } from '@noocodex/dagonizer/entities';
// ---cut---
declare const placement: PhaseNode;
const name: string = placement.name;
const phase: 'pre' | 'post' = placement.phase;
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

No `outputs` map. Pre-phase placements run in DAG declaration order before the entrypoint; a thrown error aborts the run (lifecycle becomes `failed`, the main loop never executes). Post-phase placements run in declaration order on every exit path (completion, abort, timeout, terminal-failed, node throw); a thrown error is collected as a warning (code `POST_PHASE_FAILED`) and does not change the already-set lifecycle. Phase boundaries surface via the `onPhaseEnter` / `onPhaseExit` subclass hooks on `Dagonizer`.

---

## Gather configuration

`GatherConfig` is referenced from `ScatterNode.gather` and is also exported as a standalone schema and type.

```ts twoslash
import { GatherConfigSchema } from '@noocodex/dagonizer/entities';
import type { GatherConfig } from '@noocodex/dagonizer/entities';
// ---cut---
declare const gc: GatherConfig;
const strategy: string = gc.strategy;
export {};
```

```ts twoslash
import type { GatherConfig } from '@noocodex/dagonizer/entities';
// ---cut---
// GatherConfig shape (all fields beyond `strategy` are optional):
declare const _: GatherConfig;
// strategy: string — any name registered via GatherStrategies.register
// mapping?: Record<string, string>   — map: clone path → parent path
// field?:   string                   — append/partition/collect: clone field to read
// target?:  string                   — append/collect: parent array path
// partitions?: Record<string, string> — partition: output token → parent array path
// customNode?: string                — custom: registered node name
export {};
```

| Strategy | Key fields | Behaviour |
|---|---|---|
| `map` | `mapping` (clone path → parent path) | One clone ⇒ scalar set; N clones ⇒ index-ordered array append. This is the generate-collect pattern. |
| `append` | `target` (dotted path), optional `field` | Flatten the clone `field` (or source item) across all clones into `target`. |
| `partition` | `partitions: Record<output, path>`, optional `field` | Bucket clones by their output token; write each group to its dedicated path. |
| `collect` | `target` (dotted path), optional `field` | Collect each clone's output token (or `field` value) into `target` in source-index order. |
| `discard` | (none) | No-op. No clone state flows back to the parent. Use for side-effect-only fan-outs. |
| `custom` | `customNode` (registered name) | Stage per-clone records under `state.metadata.gatherResults` and dispatch the named node. |

Strategies are pluggable: register a new one with `GatherStrategies.register(strategy)`. Unknown strategy names are caught at runtime by `GatherStrategies.resolve`. See [Reference: Core](./core).

---

## Related guides

- [DAGBuilder](../guide/builder)
- [Lifecycle phases](../guide/lifecycle-phases)
- [Terminal placements](../examples/09-terminals)
- [Subclassing state](../guide/subclassing)
