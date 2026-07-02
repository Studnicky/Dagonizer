---
seeAlso:
  - text: 'Reference: Validation'
    link: './validation'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: 'interfaces narrow these entities'
---

# Entities

`@studnicky/dagonizer/entities`

JSON Schema constants for every shape in the package. Each schema is assigned a stable `$id` URI. TypeScript types are derived from schemas via `json-schema-to-ts`.

---

## `DAGSchema`

```ts twoslash
import { DAGSchema } from '@studnicky/dagonizer/entities';
```

`$id`: `https://noocodex.dev/schemas/dagonizer/DAG`

Top-level DAG declaration in JSON-LD 1.1 canonical form. Required properties: `@context`, `@id`, `@type: 'DAG'`, `name`, `version`, `entrypoint`, `nodes`. Each entry in `nodes` is validated against a `oneOf` covering every placement variant (`SingleNode`, `ScatterNode`, `EmbeddedDAGNode`, `TerminalNode`, `PhaseNode`), discriminated by the `@type` field.

```ts twoslash
import type { DAGType } from '@studnicky/dagonizer/entities';
```

### `@context` — prefix map for IRI expansion

The `@context` field is an optional `Record<string, string>` prefix map consumed by `ContextResolver` at registration time. Each key is a short prefix identifier; each value is the namespace IRI to prepend when expanding a `prefix:local` name.

```json
{
  "@context": {
    "myPlugin": "https://myplugin.dev/dag#"
  }
}
```

Every `name`, `node`, `dag`, and output route value in the document is expanded through this map before the DAG enters the registry. Bare names (no colon) expand to `ContextResolver.DEFAULT_NS + name` (`https://noocodex.dev/dag/default#`). Absolute IRIs (containing `://`) pass through unexpanded.

`ContextResolver.validate` is called automatically by `registerDAG`; it throws `DAGError` if two prefix keys map to the same namespace IRI (a collision that would make inverse lookups ambiguous).

For the full expansion rules and multi-plugin isolation examples, see [Guide: IRI identity](../guide/iri-identity).

---

## `SingleNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/SingleNode`

Single-node placement. Required: `@id`, `@type: 'SingleNode'`, `name`, `node`, `outputs`.

```ts twoslash
import { SingleNodeSchema } from '@studnicky/dagonizer/entities';
import type { SingleNodeType } from '@studnicky/dagonizer/entities';
```

`outputs` is a `Record<string, string>`: each key is an output name, the value is the next placement name. Flows terminate at an explicit `TerminalNode` placement, not via a `null` output value.

---

## `ScatterNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/ScatterNode`

Scatter placement: fork a source array (one clone per item), run a body (node or sub-DAG) in each clone, fold clone state back through a required `gather`, and route on the aggregate outcome. Required: `@id`, `@type: 'ScatterNode'`, `name`, `body`, `source`, `gather`, `outputs`. Optional: `itemKey` (default `currentItem`), `execution` (unified concurrency-limiting policy — `{ mode: 'item', concurrency?, throttle? } | { mode: 'reservoir', concurrency?, reservoir }`, default `{ mode: 'item', concurrency: 1 }`; see [`ScatterNode`](/reference/nodes#scatternode) for the full `item` vs `reservoir` semantics), `stateMapping.input`, `reducer`.

```ts twoslash
import { ScatterNodeSchema } from '@studnicky/dagonizer/entities';
import type { ScatterNodeType } from '@studnicky/dagonizer/entities';
```

`body` is a discriminated union: `{ node: string }` for a registered node body or `{ dag: string }` for a registered sub-DAG body.

`stateMapping.input` seeds each clone before its body runs: a `Record<string, string>` mapping child-state keys to parent-state dotted paths. This is the same seeding concept and orientation as `EmbeddedDAGNode.stateMapping.input`. Scatter has no `stateMapping.output`: the N→1 merge back into the parent is `gather`'s job. Builder option: `inputs` in `ScatterOptionsType`.

---

## `EmbeddedDAGNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/EmbeddedDAGNode`

Embedded-DAG placement: invoke a nested DAG exactly once (cardinality 1) with optional bidirectional state mapping. Required: `@id`, `@type: 'EmbeddedDAGNode'`, `name`, `dag` (registered DAG name), `outputs`. Optional: `stateMapping`.

```ts twoslash
import { EmbeddedDAGNodeSchema } from '@studnicky/dagonizer/entities';
import type { EmbeddedDAGNodeType } from '@studnicky/dagonizer/entities';
```

`stateMapping.input` seeds the child before it runs (child-state key → parent-state dotted path). `stateMapping.output` copies fields back into the parent after the child completes (parent-state dotted path → child-state key). Builder options: `inputs` and `outputs` in `TypedEmbeddedDAGOptionsType`.

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
import { GatherConfigSchema } from '@studnicky/dagonizer/entities';
import type { GatherConfigType } from '@studnicky/dagonizer/entities';
```

---

## `TerminalNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/TerminalNode`

Explicit terminal placement. Required: `@id`, `@type: 'TerminalNode'`, `name`, `outcome` (enum: `completed` | `failed`). No `outputs` field. TerminalNodes are leaves.

```ts twoslash
import { TerminalNodeSchema } from '@studnicky/dagonizer/entities';
import type { TerminalNodeType } from '@studnicky/dagonizer/entities';
```

When the engine reaches a `TerminalNode`, the flow ends with the declared `outcome`. `outcome: 'completed'` resolves the state cleanly; `outcome: 'failed'` marks the state as failed before resolving. See [`DAGBuilder.terminal()`](../guide/builder#terminal-name-outcome) for the authoring API and [Phase 09 · Terminal placements](../examples/09-terminals) for runnable examples.

---

## `PhaseNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/PhaseNode`

Lifecycle-attached placement that runs outside the main DAG loop. Required: `@id`, `@type: 'PhaseNode'`, `name`, `node` (registered node name), `phase` (enum: `pre` | `post`). No `outputs` field.

```ts twoslash
import { PhaseNodeSchema } from '@studnicky/dagonizer/entities';
import type { PhaseNodeType } from '@studnicky/dagonizer/entities';
```

`pre` placements run in declaration order before the entrypoint; an error aborts the run. `post` placements run on every exit path; errors are collected as warnings (code `POST_PHASE_FAILED`). See [Reference: Nodes](./nodes#phasenode) for the placement table.

---

## `DAGLifecycleStateSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/DAGLifecycleState`

JSON-serializable wire shape of `DAGLifecycleState`. Covers all six `variant` values with their required timestamp fields. The discriminant field is `variant` (not `kind`).

```ts twoslash
import { DAGLifecycleStateSchema } from '@studnicky/dagonizer/entities';
import type { DAGLifecycleStateDataType } from '@studnicky/dagonizer/entities';
```

---

## `CheckpointDataSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/CheckpointData`

Persistable snapshot of an in-flight DAG execution. Required: `dagName`, `cursor` (string or null), `state` (object), `executedNodes`, `skippedNodes`, `stores` (named-store snapshots keyed by store name; empty object when no stores were captured).

```ts twoslash
import { CheckpointDataSchema } from '@studnicky/dagonizer/entities';
import type { CheckpointDataType } from '@studnicky/dagonizer/entities';
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
} from '@studnicky/dagonizer/entities';
```

## Execution and reporting schemas

| Schema | Derived type | Purpose |
|---|---|---|
| `ExecutionResultSchema` | `ExecutionResult` | Wire shape of `ExecutionResultType` (no narrowed `state`) |
| `ValidationResultSchema` | `ValidationResult` | Validation envelope used by node `validate()` |
| `DAGErrorJSONSchema` | `DAGErrorJSON` | JSON shape returned from `DAGError.toJSON()` |

`InterruptionInfo` (`{ nodeName: string, reason: 'abort' | 'timeout' }`) lives alongside `ExecutionResultType` and is exported from the root barrel.

## Constant value+type pairs

These constants are available from `@studnicky/dagonizer/constants` as value+type pairs. Each constant is a frozen lookup object AND a `FromSchema`-derived type with the same name. `BackoffStrategy` ships through `@studnicky/dagonizer/runtime`, not `./constants`.

<<< @/../examples/dags/constants-usage.ts#constants

Each constant is exported as a value object (plural name) paired with a type (singular name) so the JSON literal can be used as a discriminator.

| Value | Type | Members |
|---|---|---|
| `GatherStrategyNames` | `GatherStrategyName` | `'map'`, `'append'`, `'partition'`, `'custom'`, `'collect'`, `'discard'` |
| `ScatterOutputNames` | `ScatterOutput` | `'all-success'`, `'partial'`, `'all-error'`, `'empty'` |
| `MetadataKeys` | `MetadataKey` | `'currentItem'`, `'gatherResults'`, `'itemIndex'` |
| `OutputNames` | `Output` | Reserved canonical output names |
| `NodeTypes` | `NodeType` | `'embedded'`, `'scatter'`, `'single'` |
| `BackoffStrategyNames` | `BackoffStrategy` | `'constant'`, `'linear'`, `'exponential'`, `'decorrelated-jitter'` |

Each constant has a matching `*Schema` JSON Schema for `oneOf`-style validation. See [Reference: Runtime](./runtime#const-backoffstrategynames-and-type-backoffstrategy) for `BackoffStrategyNames` usage details.

---

## JSON types

```ts twoslash
import type { JsonValueType, JsonObjectType, JsonArrayType, JsonPrimitiveType } from '@studnicky/dagonizer/entities';
```

| Type | Description |
|------|-------------|
| `JsonPrimitiveType` | `string \| number \| boolean \| null` |
| `JsonValueType` | `JsonPrimitiveType \| JsonObjectType \| JsonArrayType` |
| `JsonObjectType` | `Record<string, JsonValueType>` |
| `JsonArrayType` | `JsonValueType[]` |

Used as the constraint for `snapshotData()` return values and `restoreData()` arguments.
## Related guides

- [Schema & JSON loading](../guide/schema)
- [DAGBuilder](../guide/builder)
