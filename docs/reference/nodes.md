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
    description: '`ParallelCombiner`, `FanInStrategy`'
---

# Nodes

Placement types: the appearances of nodes inside a `DAG`. Each placement is a discriminated union member keyed by `@type`, ships with a JSON Schema in `@noocodex/dagonizer/entities`, and resolves to a typed TS shape via `json-schema-to-ts`.

A registered `NodeInterface` (the consumer-implemented unit of work) is referenced from a placement by name. A "node" is the unit of work. A "placement" is its appearance inside a `DAG`. `TerminalNode` is placement-only and references no registered node.

| Placement `@type` | Schema | TS type | Purpose |
|---|---|---|---|
| `SingleNode` | `SingleNodeSchema` | `SingleNode`, `SingleNodePlacementInterface<TOutput>` | Run one registered node; route per output |
| `ParallelNode` | `ParallelNodeSchema` | `ParallelNode` | Run a group of single-node placements concurrently; combine outputs |
| `FanOutNode` | `FanOutNodeSchema` | `FanOutNode` | Run one node per element of a state array; fan-in the aggregate |
| `EmbeddedDAGNode` | `EmbeddedDAGNodeSchema` | `EmbeddedDAGNode` | Invoke another registered DAG with state mapping |
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

## `FanOutNode`

```ts
import { FanOutNodeSchema } from '@noocodex/dagonizer/entities';
import type { FanOutNode } from '@noocodex/dagonizer/entities';
```

```json
{
  "@id":         "urn:noocodex:dag:my-dag/node/scout",
  "@type":       "FanOutNode",
  "name":        "scout",
  "node":        "scout-worker",
  "source":      "results.queries",
  "itemKey":     "currentItem",
  "concurrency": 4,
  "fanIn":       { "strategy": "append", "target": "results.candidates" },
  "outputs":     { "all-success": "rank", "partial": "rank", "all-error": null, "empty": null }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'FanOutNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name |
| `node` | `string` | yes | Registered `NodeInterface.name` invoked per item |
| `source` | `string` | yes | Dotted state path of the input array |
| `fanIn` | `FanInConfig` | yes | Strategy + strategy-specific config |
| `outputs` | `Record<string, string \| null>` | yes | Aggregate routes keyed by `all-success`, `partial`, `all-error`, `empty` |
| `itemKey` | `string` | no | Metadata key the worker reads (default `'currentItem'`) |
| `concurrency` | `number` | no | Batch size for `Promise.all` (default: source length) |

`FanInConfig` is documented under [Fan-in configuration](#fan-in-configuration) below.

Per-item resume bookkeeping is persisted under the reserved metadata key `FAN_OUT_PROGRESS_KEY` so a checkpoint-resume cycle skips items completed in the prior run.

---

## `EmbeddedDAGNode`

```ts
import { EmbeddedDAGNodeSchema } from '@noocodex/dagonizer/entities';
import type { EmbeddedDAGNode } from '@noocodex/dagonizer/entities';
```

```json
{
  "@id":  "urn:noocodex:dag:parent/node/enrich",
  "@type": "EmbeddedDAGNode",
  "name": "enrich",
  "dag":  "enrich-pipeline",
  "stateMapping": {
    "input":  { "query": "request.query" },
    "output": { "results.candidates": "candidates" }
  },
  "outputs": { "success": "rank", "error": null }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `@id` | `string` | yes | Placement URN |
| `@type` | `'EmbeddedDAGNode'` | yes | Discriminator |
| `name` | `string` | yes | Placement name |
| `dag` | `string` | yes | Registered DAG name to invoke |
| `outputs` | `Record<string, string \| null>` | yes | Routes; keys are `success` and `error` |
| `stateMapping.input` | `Record<string, string>` | no | Child-state key to parent dotted path (populates the child before invocation) |
| `stateMapping.output` | `Record<string, string>` | no | Parent dotted path to child-state key (writes child output back into the parent) |

The child runs through the same `runNodes` generator with `isEmbeddedDAG: true`: phase placements and lifecycle transitions are suppressed inside the child. A `TerminalNode(failed)` inside the child surfaces as `'error'` on the parent placement.

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

## Fan-in configuration

`FanInConfig` is referenced from `FanOutNode.fanIn` and is also exported as a standalone schema and type.

```ts
import { FanInConfigSchema } from '@noocodex/dagonizer/entities';
import type { FanInConfig } from '@noocodex/dagonizer/entities';
```

```ts
type FanInConfig =
  | { strategy: 'append';    target: string }
  | { strategy: 'partition'; partitions: Record<string, string> }
  | { strategy: 'custom';    customNode: string };
```

| Strategy | Required field | Behaviour |
|---|---|---|
| `append` | `target` (dotted path) | Flatten every result bucket and append to the path |
| `partition` | `partitions: Record<output, path>` | Append each per-output bucket to its dedicated path |
| `custom` | `customNode` (registered name) | Stage results under `state.metadata.fanInResults` and dispatch the named node |

Strategies are pluggable: register a new one with `FanInStrategies.register(strategy)`. See [Reference: Core](./core).

---

## Related guides

- [DAGBuilder](../guide/builder)
- [Lifecycle phases](../guide/lifecycle-phases)
- [Terminal placements](../examples/09-terminals)
- [Subclassing state](../guide/subclassing)
