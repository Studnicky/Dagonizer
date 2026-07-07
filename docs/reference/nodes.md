---
title: 'Nodes'
description: 'Placement reference for SingleNode, ScatterNode, EmbeddedDAGNode, TerminalNode, PhaseNode, gather configuration, and execution policy.'
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

## What It Is

This page documents the placement shapes that can appear inside a JSON-LD `DAG`: `SingleNode`, `ScatterNode`, `EmbeddedDAGNode`, `TerminalNode`, and `PhaseNode`.

Use it when authoring, validating, rendering, or debugging the graph document that points at registered node implementations.

## How It Works

A registered `NodeInterface` is the unit of work. A placement is that unit's appearance inside one DAG document. One registered node can appear in multiple placements; each placement owns routing, state mapping, scatter policy, phase role, or terminal outcome.

`TerminalNode` is placement-only and references no registered node. `EmbeddedDAGNode` references another registered DAG. `ScatterNode` creates isolated clone work and folds the result back through gather/reduce policy.

## Diagrams, Examples, and Outputs

Placement shapes are easiest to read beside real DAG diagrams. These pages show the same JSON-LD placements rendered into Mermaid or the runnable browser graph:

- [Reference: Entities](./entities) - JSON Schema sources for every placement
- [Reference: Contracts](./contracts) - `NodeInterface`, the contract a placement references
- [Reference: Core](./core) - `GatherStrategy`, `OutcomeReducer`

## What It Lets You Do

The nodes reference lets applications understand every placement shape a JSON-LD DAG can contain.

Placement types: the appearances of nodes inside a `DAG`. Each placement is a discriminated union member keyed by `@type`, ships with a JSON Schema in `@studnicky/dagonizer/entities`, and resolves to a typed TS shape via `json-schema-to-ts`.

A registered `NodeInterface` is referenced from a placement by name. A "node" is the unit of work. A "placement" is its appearance inside a `DAG`.

| Placement `@type` | Schema | TS type | Purpose |
|---|---|---|---|
| `SingleNode` | `SingleNodeSchema` | `SingleNode`, `SingleNodePlacementType<TOutput>` | Run one registered node; route per output |
| `ScatterNode` | `ScatterNodeSchema` | `ScatterNode` | Isolate one clone per source-array item, run a body, fold clone state back through a required `gather`, route on aggregate outcome |
| `EmbeddedDAGNode` | `EmbeddedDAGNodeSchema` | `EmbeddedDAGNode` | Invoke a registered sub-DAG exactly once (cardinality 1); route on the child's terminal outcome |
| `TerminalNode` | `TerminalNodeSchema` | `TerminalNode` | End the flow with an explicit `outcome` |
| `PhaseNode` | `PhaseNodeSchema` | `PhaseNode` | Pre/post lifecycle hook running outside the main loop |

Every schema's `$id` is `https://noocodex.dev/schemas/dagonizer/<TypeName>`.

## Code Samples

The code below covers placement imports, JSON-LD shape, routing, gather policy, state mapping, and terminal behavior.

### Import

```ts twoslash
import type {
  EmbeddedDAGNodeType,
  PhaseNodeType,
  ScatterNodeType,
  SingleNodeType,
  TerminalNodeType,
} from '@studnicky/dagonizer/entities';
```

---

### `SingleNode`

```ts twoslash
import { SingleNodeSchema } from '@studnicky/dagonizer/entities';
import type { SingleNodeType, SingleNodePlacementType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const placement: SingleNodeType;
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

`SingleNodePlacementType<TOutput extends string>` narrows `outputs` to `Record<TOutput, string>` for compile-time exhaustiveness when `TOutput` is a literal union.

---

### `ScatterNode`

```ts twoslash
import { ScatterNodeSchema } from '@studnicky/dagonizer/entities';
import type { ScatterNodeType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const placement: ScatterNodeType;
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
  "execution":   { "mode": "item", "concurrency": 4 },
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
| `execution` | `{ mode: 'item', concurrency?, throttle? } \| { mode: 'reservoir', concurrency?, reservoir }` | no | Unified concurrency-limiting policy — ONE discriminated `mode` structure instead of separate `concurrency`/`throttle`/`reservoir` knobs. Defaults to `{ mode: 'item', concurrency: 1 }` when absent. See [Execution policy](#execution-policy) below. |
| `stateMapping` | `{ input?: Record<childKey, parentPath> }` | no | Seeds each clone: `input` copies parent fields into the clone before the body runs. Authored via the `inputs` builder option. |
| `gather` | `GatherConfig` | **yes** | How produced clone state merges back into the parent. Use `{ strategy: 'discard' }` for side-effect-only fan-outs. |
| `reducer` | `string` | no | Outcome reducer name. Defaults to `'aggregate'`. Built-in: `'aggregate'`, `'terminal'`, `'all-success'`, `'any-success'`. Custom reducers registered via `OutcomeReducers.register` are referenceable by name. |
| `container` | `string` | no | Logical container role name for `{ dag }` bodies only. Bound at construction via `DagonizerOptionsType.containers`. On a dispatcher with a non-empty `containers` registry, a role this placement declares but does not bind throws `DAGError` at `registerDAG` time. A pure in-process dispatcher (empty `containers`) treats the role as inert and runs the body in-process. Setting `container` on a `{ node }` body is a validation error. |

`GatherConfig` is documented under [Gather configuration](#gather-configuration) below.

#### Execution policy

`execution` groups scatter concurrency-limiting into ONE discriminated `mode`
structure instead of three uncoordinated sibling fields:

- **`{ mode: 'item', concurrency?, throttle? }`** (the default: `{ mode: 'item', concurrency: 1 }`
  when `execution` is absent). `concurrency` is an item-level `Semaphore`
  permit count — the maximum number of clone bodies executing at once.
  `throttle`, when present (`{ concurrencyLimit: number, adaptive? }`), wraps
  dispatch through a second, independent `Throttle` concurrency window on top
  of the semaphore: the semaphore still caps how far the pull loop runs ahead
  of dispatch capacity, while `throttle.concurrencyLimit` further paces the
  actual item-execution calls. `throttle.adaptive` passes substrate adaptive
  concurrency tuning through to `Throttle`.
- **`{ mode: 'reservoir', concurrency?, reservoir }`**: items are buffered by
  `reservoir.keyField` and released as a batch per key when
  `reservoir.capacity` is reached, `reservoir.idleMs` elapses, or the source
  drains. `concurrency` still applies here — the SAME semaphore concept, but
  at batch granularity: the maximum number of released batches dispatched
  concurrently, not the maximum number of items. There is no `throttle` field
  in this mode; the schema structurally forbids combining `throttle` with
  `reservoir` because a per-item `Throttle` does not compose with
  variable-size batch dispatch.

Per-item resume bookkeeping is persisted under the reserved metadata key `SCATTER_PROGRESS_KEY` so a checkpoint-resume cycle skips clones completed in the prior run.

See [Execution tuning](/guide/execution-tuning) for when to choose scatter
`concurrency`, throttle, adaptive concurrency, token buckets, circuit breakers,
retry, and coalescing.

---

### `EmbeddedDAGNode`

```ts twoslash
import { EmbeddedDAGNodeSchema } from '@studnicky/dagonizer/entities';
import type { EmbeddedDAGNodeType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const placement: EmbeddedDAGNodeType;
const name: string = placement.name;
// Exactly one of `dag` (build-time literal) or `dagFrom` (state path) is present.
const dag: string | undefined = placement.dag;
const dagFrom: string | undefined = placement.dagFrom;
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
| `dag` | `string` | one of `dag`/`dagFrom` | Build-time literal: registered sub-DAG name to invoke (cardinality 1) |
| `dagFrom` | `string` | one of `dag`/`dagFrom` | Dotted state path resolved at execution time to the registered sub-DAG name; the item-scoped form used by scatter bodies |
| `outputs` | `Record<'success' \| 'error', string \| null>` | yes | Routes for the child's terminal outcome |
| `stateMapping` | `{ input?: Record<string, string>; output?: Record<string, string> }` | no | `input` copies parent fields into the child before it runs (child-key ← parent-path); `output` copies child fields back into the parent after it completes (parent-path ← child-key). |

`EmbeddedDAGNode` invokes a registered sub-DAG exactly once (cardinality 1). It is the embedding primitive: the parent flow suspends, the child DAG runs to completion in an isolated state (a fresh child clone, not a shared parent reference), and the parent routes on the child's terminal outcome (`success` when the child lifecycle is `completed`; `error` when `failed`). The target sub-DAG is named either by the build-time literal `dag` or by `dagFrom`, a dotted state path resolved per execution — the item-scoped form a scatter body uses to invoke a different child per item. Exactly one of the two is present, enforced by the DAG validator. Authored via `.embed(name, dagName, routes, { inputs, outputs })` on `DAGBuilder`.

---

### `TerminalNode`

```ts twoslash
import { TerminalNodeSchema } from '@studnicky/dagonizer/entities';
import type { TerminalNodeType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const placement: TerminalNodeType;
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

No `outputs` map. Placement-only (no backing `NodeInterface`). On reach, the engine fires `state.markCompleted()` or `state.markFailed(...)` and ends the loop. The placement-level `outcome` surfaces on `ExecutionResultType.terminalOutcome`.

---

### `PhaseNode`

```ts twoslash
import { PhaseNodeSchema } from '@studnicky/dagonizer/entities';
import type { PhaseNodeType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const placement: PhaseNodeType;
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

### Gather configuration

`GatherConfig` is referenced from `ScatterNode.gather` and is also exported as a standalone schema and type.

```ts twoslash
import { GatherConfigSchema } from '@studnicky/dagonizer/entities';
import type { GatherConfigType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const gc: GatherConfigType;
const strategy: string = gc.strategy;
export {};
```

```ts twoslash
import type { GatherConfigType } from '@studnicky/dagonizer/entities';
// ---cut---
// GatherConfigType shape (all fields beyond `strategy` are optional):
declare const _: GatherConfigType;
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

## Details for Nerds

Placement JSON is the stable topology contract. Runtime node instances do not serialize into the DAG; only their registered names appear in placements. That keeps JSON-LD portable across browser demos, CLI runs, worker pools, plugin bundles, and persisted graph documents.

Scatter and embedded DAG placements are the two places where a single placement expands into another execution scope. Scatter creates multiple clone scopes and folds them back through `gather`; embedded DAGs create one child flow and route from the child terminal outcome.

## Related Concepts

- [Reference: Entities](./entities) - JSON Schema sources for every placement
- [Reference: Contracts](./contracts) - `NodeInterface`, the contract a placement references
- [Reference: Core](./core) - `GatherStrategy`, `OutcomeReducer`
- [DAGBuilder](../guide/builder) - fluent API for producing these placement shapes
- [Lifecycle Phases](../guide/lifecycle-phases) - pre/post `PhaseNode` placement behavior
- [Example 09: Terminal Nodes](../examples/09-terminals) - terminal outcomes in runnable code
- [Subclassing State](../guide/subclassing) - state shape each placement mutates
