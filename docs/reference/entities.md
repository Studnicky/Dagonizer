---
seeAlso:
  - text: 'Reference: Validation'
    link: './validation'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: 'interfaces narrow these entities'
---

# Entities

`@noocodex/dagonizer/entities`

JSON Schema constants for every shape in the package. Each schema is assigned a stable `$id` URI. TypeScript types are derived from schemas via `json-schema-to-ts`.

---

## `DAGSchema`

```ts twoslash
import { DAGSchema } from '@noocodex/dagonizer/entities';
```

`$id`: `https://noocodex.dev/schemas/dagonizer/DAG`

Top-level DAG declaration in JSON-LD 1.1 canonical form. Required properties: `@context`, `@id`, `@type: 'DAG'`, `name`, `version`, `entrypoint`, `nodes`. Each entry in `nodes` is validated against a `oneOf` covering every placement kind (`SingleNode`, `ScatterNode`, `EmbeddedDAGNode`, `TerminalNode`, `PhaseNode`).

```ts twoslash
import type { DAG } from '@noocodex/dagonizer/entities';
```

---

## `SingleNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/SingleNode`

Single-node placement. Required: `@id`, `@type: 'SingleNode'`, `name`, `node`, `outputs`.

```ts twoslash
import { SingleNodeSchema } from '@noocodex/dagonizer/entities';
import type { SingleNode } from '@noocodex/dagonizer/entities';
```

`outputs` is a `Record<string, string>`: each key is an output name, the value is the next placement name. Flows terminate at an explicit `TerminalNode` placement, not via a `null` output value.

---

## `ScatterNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/ScatterNode`

Scatter placement: fork a source array (one clone per item), run a body (node or sub-DAG) in each clone, fold clone state back through a required `gather`, and route on the aggregate outcome. Required: `@id`, `@type: 'ScatterNode'`, `name`, `body`, `source`, `gather`, `outputs`. Optional: `itemKey` (default `currentItem`), `concurrency`, `stateMapping.input`, `reducer`.

```ts twoslash
import { ScatterNodeSchema } from '@noocodex/dagonizer/entities';
import type { ScatterNode } from '@noocodex/dagonizer/entities';
```

`body` is a discriminated union: `{ node: string }` for a registered node body or `{ dag: string }` for a registered sub-DAG body.

`stateMapping.input` seeds each clone before its body runs: a `Record<string, string>` mapping child-state keys to parent-state dotted paths. This is the same seeding concept and orientation as `EmbeddedDAGNode.stateMapping.input`. Scatter has no `stateMapping.output`: the N→1 merge back into the parent is `gather`'s job. Builder option: `inputs` in `ScatterOptionsInterface`.

---

## `EmbeddedDAGNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/EmbeddedDAGNode`

Embedded-DAG placement: invoke a nested DAG exactly once (cardinality 1) with optional bidirectional state mapping. Required: `@id`, `@type: 'EmbeddedDAGNode'`, `name`, `dag` (registered DAG name), `outputs`. Optional: `stateMapping`.

```ts twoslash
import { EmbeddedDAGNodeSchema } from '@noocodex/dagonizer/entities';
import type { EmbeddedDAGNode } from '@noocodex/dagonizer/entities';
```

`stateMapping.input` seeds the child before it runs (child-state key → parent-state dotted path). `stateMapping.output` copies fields back into the parent after the child completes (parent-state dotted path → child-state key). Builder options: `inputs` and `outputs` in `TypedEmbeddedDAGOptionsInterface`.

Use `EmbeddedDAGNode` for a single nested-DAG invocation (cardinality 1). For a 1→N fork over a source array, use `ScatterNode` with `source`.

---

## `GatherConfigSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/GatherConfig`

Gather strategy configuration for scatter nodes. Required: `strategy` (open `string`; built-in values: `map`, `append`, `partition`, `custom`, `collect`, `discard`; custom strategies registered via `GatherStrategies.register` are also referenceable). Strategy-specific fields:

| Strategy | Key fields |
|----------|-----------|
| `map` | `mapping: Record<clonePath, parentPath>` |
| `append` | `target: string` (parent array path); optional `field` (clone path; omit ⇒ source item) |
| `partition` | `partitions: Record<outputToken, parentPath>`; optional `field` |
| `collect` | `target: string` (parent array path); optional `field` |
| `discard` | (none) — no-op; use for side-effect-only fan-outs |
| `custom` | `customNode: string` (registered node name) |

```ts twoslash
import { GatherConfigSchema } from '@noocodex/dagonizer/entities';
import type { GatherConfig } from '@noocodex/dagonizer/entities';
```

---

## `TerminalNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/TerminalNode`

Explicit terminal placement. Required: `@id`, `@type: 'TerminalNode'`, `name`, `outcome` (enum: `completed` | `failed`). No `outputs` field. TerminalNodes are leaves.

```ts twoslash
import { TerminalNodeSchema } from '@noocodex/dagonizer/entities';
import type { TerminalNode } from '@noocodex/dagonizer/entities';
```

When the engine reaches a `TerminalNode`, the flow ends with the declared `outcome`. `outcome: 'completed'` resolves the state cleanly; `outcome: 'failed'` marks the state as failed before resolving. See [`DAGBuilder.terminal()`](../guide/builder#terminal-name-outcome) for the authoring API and [Phase 09 · Terminal placements](../examples/09-terminals) for runnable examples.

---

## `PhaseNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/PhaseNode`

Lifecycle-attached placement that runs outside the main DAG loop. Required: `@id`, `@type: 'PhaseNode'`, `name`, `node` (registered node name), `phase` (enum: `pre` | `post`). No `outputs` field.

```ts twoslash
import { PhaseNodeSchema } from '@noocodex/dagonizer/entities';
import type { PhaseNode } from '@noocodex/dagonizer/entities';
```

`pre` placements run in declaration order before the entrypoint; an error aborts the run. `post` placements run on every exit path; errors are collected as warnings (code `POST_PHASE_FAILED`). See [Reference: Nodes](./nodes#phasenode) for the placement table.

---

## `DAGLifecycleStateSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/DAGLifecycleState`

JSON-serializable wire shape of `DAGLifecycleState`. Covers all six `kind` variants with their required timestamp fields.

```ts twoslash
import { DAGLifecycleStateSchema } from '@noocodex/dagonizer/entities';
import type { DAGLifecycleStateData } from '@noocodex/dagonizer/entities';
```

---

## `CheckpointDataSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/CheckpointData`

Persistable snapshot of an in-flight DAG execution. Required: `version`, `dagName`, `cursor` (string or null), `state` (object), `executedNodes`, `skippedNodes`, `stores` (named-store snapshots keyed by store name; empty object when no stores were captured).

```ts twoslash
import { CheckpointDataSchema, CHECKPOINT_DATA_VERSION } from '@noocodex/dagonizer/entities';
import type { CheckpointData } from '@noocodex/dagonizer/entities';
```

---

## Node runtime schemas

Runtime wire shapes used during execution. Each schema has a derived TS type with the same name and a matching `Validator` accessor.

| Schema | Derived type | Purpose |
|---|---|---|
| `NodeSchema` | `Node` | Generic node descriptor at the wire boundary |
| `NodeContextSchema` | `NodeContext` | Execution context passed to `NodeInterface.execute` |
| `NodeOutputSchema` | `NodeOutput` | Wire shape of `{ output, errors? }` |
| `NodeResultSchema` | `NodeResult` | Per-node result yielded by the executor |
| `NodeErrorSchema` | `NodeError` | Collected error envelope |
| `NodeWarningSchema` | `NodeWarning` | Collected warning envelope |
| `NodeStateDataSchema` | `NodeStateData` | JSON snapshot shape of `NodeStateBase` |

```ts twoslash
import {
  NodeSchema,
  NodeContextSchema,
  NodeOutputSchema,
  NodeResultSchema,
  NodeErrorSchema,
  NodeWarningSchema,
  NodeStateDataSchema,
} from '@noocodex/dagonizer/entities';
```

## Execution and reporting schemas

| Schema | Derived type | Purpose |
|---|---|---|
| `ExecutionResultSchema` | `ExecutionResult` | Wire shape of `ExecutionResultInterface` (no narrowed `state`) |
| `ValidationResultSchema` | `ValidationResult` | Validation envelope used by node `validate()` |
| `DAGErrorJSONSchema` | `DAGErrorJSON` | JSON shape returned from `DAGError.toJSON()` |

`InterruptionInfo` (`{ nodeName: string, reason: 'abort' | 'timeout' }`) lives alongside `ExecutionResultInterface` and is exported from the root barrel.

## Constant value+type pairs

These constants are available from `@noocodex/dagonizer/constants` as value+type pairs. Each constant is a frozen lookup object AND a `FromSchema`-derived type with the same name. `BackoffStrategy` ships through `@noocodex/dagonizer/runtime`, not `./constants`.

<<< @/../examples/dags/constants-usage.ts#constants

Constants are exported with paired value and type so the JSON literal can be used as a discriminator.

| Constant | Members |
|---|---|
| `GatherStrategyName` | `'map'`, `'append'`, `'partition'`, `'custom'`, `'collect'`, `'discard'` |
| `ScatterOutput` | `'all-success'`, `'partial'`, `'all-error'`, `'empty'` |
| `MetadataKey` | `'currentItem'`, `'gatherResults'`, `'itemIndex'` |
| `Output` | Reserved canonical output names |
| `NodeType` | `'embedded'`, `'scatter'`, `'single'` |
| `BackoffStrategy` | `'constant'`, `'linear'`, `'exponential'`, `'decorrelated-jitter'` |

Each constant has a matching `*Schema` JSON Schema for `oneOf`-style validation. See [Reference: Runtime](./runtime#const-backoffstrategy) for `BackoffStrategy` usage details.

---

## JSON types

```ts twoslash
import type { JsonValue, JsonObject, JsonArray, JsonPrimitive } from '@noocodex/dagonizer/entities';
```

| Type | Description |
|------|-------------|
| `JsonPrimitive` | `string \| number \| boolean \| null` |
| `JsonValue` | `JsonPrimitive \| JsonObject \| JsonArray` |
| `JsonObject` | `Record<string, JsonValue>` |
| `JsonArray` | `JsonValue[]` |

Used as the constraint for `snapshotData()` return values and `restoreData()` arguments.
## Related guides

- [Schema & JSON loading](../guide/schema)
- [DAGBuilder](../guide/builder)
