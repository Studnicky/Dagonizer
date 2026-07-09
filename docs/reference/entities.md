---
title: 'Entities'
description: 'JSON Schema and derived TypeScript entity reference for DAG documents, placements, lifecycle state, checkpoints, node results, and constants.'
seeAlso:
  - text: 'Reference: Validation'
    link: './validation'
  - text: 'Reference: Contracts'
    link: './contracts'
    description: 'interfaces narrow these entities'
---

# Entities

## What It Is

Entities are the JSON Schema-backed wire shapes used by DAG documents, placements, lifecycle state, checkpoints, node results, and constants.

Use this page when validating JSON-LD, typing external artifacts, inspecting schema `$id` values, or building tooling that reads and writes Dagonizer documents.

## How It Works

Each entity exports a JSON Schema constant and a TypeScript type derived from that schema with `json-schema-to-ts`. The schema is the source of truth; TypeScript follows the wire format.

Schemas prove structure. Dispatcher registration proves semantic references against the current registry.

## Diagrams, Examples, and Outputs

Entities are the schema layer under DAG diagrams and validation. These pages show where the shapes are validated and narrowed:

- [Reference: Validation](./validation)
- [Reference: Contracts](./contracts) - interfaces narrow these entities

## What It Lets You Do

The entities reference lets applications inspect every JSON Schema-derived wire type used by DAG documents, lifecycle records, checkpoints, execution results, and constants.

`@studnicky/dagonizer/entities`

JSON Schema constants for every shape in the package. Each schema is assigned a stable `$id` URI. TypeScript types are derived from schemas via `json-schema-to-ts`.

## Code Samples

The code below covers the exported schemas, derived types, placement unions, checkpoint payloads, execution results, and constant value/type pairs.

### Import

```ts twoslash
import { DAGSchema, SingleNodeSchema, ScatterNodeSchema } from '@studnicky/dagonizer/entities';
import type { DAGType, SingleNodeType, ScatterNodeType } from '@studnicky/dagonizer/entities';
```

---

### `DAGSchema`

```ts twoslash
import { DAGSchema } from '@studnicky/dagonizer/entities';
```

`$id`: `https://noocodec.dev/schemas/dagonizer/DAG`

Top-level DAG declaration in JSON-LD 1.1 canonical form. Required properties: `@context`, `@id`, `@type: 'DAG'`, `name`, `version`, `entrypoints`, `nodes`. The DAG `@id` is the registry identity; `name` is a display and observability label. Each entry in `nodes` is validated against a `oneOf` covering every placement variant (`SingleNode`, `ScatterNode`, `EmbeddedDAGNode`, `GatherNode`, `TerminalNode`, `PhaseNode`), discriminated by the `@type` field.

```ts twoslash
import type { DAGType } from '@studnicky/dagonizer/entities';
```

#### `@context` — prefix map for IRI expansion

The `@context` field is an optional `Record<string, string>` prefix map consumed by `ContextResolver` at registration time. Each key is a short prefix identifier; each value is the namespace IRI to prepend when expanding a `prefix:local` name.

```json
{
  "@context": {
    "myPlugin": "https://myplugin.dev/dag#"
  }
}
```

The DAG `@id`, registered node references (`node`), registered DAG references (`dag`), and dynamic `DagReference.candidates` resolve through this map before registry lookup. Absolute IRIs pass through unchanged. Declared `prefix:local` CURIEs expand to their namespace IRI. Bare names and undeclared prefixes are invalid; the engine never invents an IRI from display text.

Placement `@id` values, `entrypoints`, output route targets, and `GatherNode.sources` form the graph topology. Author them as explicit placement or entrypoint IRIs. `DAGBuilder` materializes routes to those IRIs during `build()`.

`ContextResolver.validate` is called automatically by `registerDAG`; it throws `DAGError` if two prefix keys map to the same namespace IRI (a collision that would make inverse lookups ambiguous).

For the full expansion rules and multi-plugin isolation examples, see [Guide: IRI identity](../guide/iri-identity).

---

### `SingleNodeSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/SingleNode`

Single-node placement. Required: `@id`, `@type: 'SingleNode'`, `name`, `node`, `outputs`. The placement `@id` is runtime identity; `name` is display/observability only.

```ts twoslash
import { SingleNodeSchema } from '@studnicky/dagonizer/entities';
import type { SingleNodeType } from '@studnicky/dagonizer/entities';
```

`outputs` is a `Record<string, string>`: each key is an output name, the value is the next placement IRI. Flows terminate at an explicit `TerminalNode` placement; output maps always target placements.

---

### `ScatterNodeSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/ScatterNode`

Scatter placement: fork a source array (one clone per item), run a body (node or sub-DAG) in each clone, emit clone outcome records for downstream gather nodes, and route on the aggregate outcome. Required: `@id`, `@type: 'ScatterNode'`, `name`, `body`, `source`, `outputs`. Optional: `itemKey` (default `currentItem`), `execution` (unified concurrency-limiting policy — `{ mode: 'item', concurrency?, throttle? } | { mode: 'reservoir', concurrency?, reservoir }`, default `{ mode: 'item', concurrency: 1 }`; see [`ScatterNode`](/reference/nodes#scatternode) for the full `item` vs `reservoir` semantics), `stateMapping.input`, `reducer`.

```ts twoslash
import { ScatterNodeSchema } from '@studnicky/dagonizer/entities';
import type { ScatterNodeType } from '@studnicky/dagonizer/entities';
```

`body` is a discriminated union: `{ node: string }` for a registered node body or `{ dag: string | DagReference }` for a registered sub-DAG body.

`stateMapping.input` seeds each clone before its body runs: a `Record<string, string>` mapping child-state keys to parent-state dotted paths. This is the same seeding concept and orientation as `EmbeddedDAGNode.stateMapping.input`. Scatter has no `stateMapping.output`: N→1 merge belongs to a downstream `GatherNode`. Builder option: `inputs` in `ScatterOptionsType`.

---

### `EmbeddedDAGNodeSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/EmbeddedDAGNode`

Embedded-DAG placement: invoke a referenced DAG exactly once (cardinality 1) with optional bidirectional state mapping. Required: `@id`, `@type: 'EmbeddedDAGNode'`, `name`, `outputs`. Optional: `dag` (literal DAG IRI or dynamic `DagReference`), `stateMapping`, `gatherResult`, `container`.

```ts twoslash
import { EmbeddedDAGNodeSchema } from '@studnicky/dagonizer/entities';
import type { EmbeddedDAGNodeType } from '@studnicky/dagonizer/entities';
```

`stateMapping.input` seeds the child before it runs (child-state key → parent-state dotted path). `stateMapping.output` copies fields back into the parent after the child completes (parent-state dotted path → child-state key). Builder options: `inputs` and `outputs` in `TypedEmbeddedDAGOptionsType`.

Use `EmbeddedDAGNode` when the selected DAG runs once. Use `ScatterNode` when the same `dag` reference surface runs once per source item. Use a downstream `GatherNode` when either placement contributes records to fan-in. Embedded DAGs, plugins, tools-as-DAGs, and dynamic references all use the same DAG-reference model.

---

### `GatherNodeSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/GatherNode`

First-class fan-in placement. Required: `@id`, `@type: 'GatherNode'`, `name`, `sources`, `gather`, `outputs`. Optional: `policy`.

```ts twoslash
import { GatherNodeSchema } from '@studnicky/dagonizer/entities';
import type { GatherNodeType } from '@studnicky/dagonizer/entities';
```

`sources` is a `Record<sourceIri, { resultField?: string }>` keyed by producer placement IRIs or entrypoint IRIs. The optional `policy` supports `{ mode: 'all' | 'any' | 'quorum'; quorum?: number; includeErrors?: boolean }`. Default policy is `all` without error records.

---

### `GatherConfigSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/GatherConfig`

Gather strategy configuration for `GatherNode.gather`. Required: `strategy` (open `string`; built-in values: `map`, `append`, `partition`, `custom`, `collect`, `discard`; custom strategies registered via `GatherStrategies.register` are also referenceable). Strategy-specific fields:

| Strategy | Key fields |
|----------|-----------|
| `map` | `mapping: Record<clonePath, parentPath>` |
| `append` | `target: string` (parent array path); optional `field` (clone path; omit ⇒ source item) |
| `partition` | `partitions: Record<outputToken, parentPath>`; optional `field` |
| `collect` | `target: string` (parent array path); optional `field` |
| `discard` | (none) — no-op; use for side-effect-only fan-outs |
| `custom` | `customNode: string` (registered node IRI) |

```ts twoslash
import { GatherConfigSchema } from '@studnicky/dagonizer/entities';
import type { GatherConfigType } from '@studnicky/dagonizer/entities';
```

---

### `TerminalNodeSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/TerminalNode`

Explicit terminal placement. Required: `@id`, `@type: 'TerminalNode'`, `name`, `outcome` (enum: `completed` | `failed`). No `outputs` field. TerminalNodes are leaves.

```ts twoslash
import { TerminalNodeSchema } from '@studnicky/dagonizer/entities';
import type { TerminalNodeType } from '@studnicky/dagonizer/entities';
```

When the engine reaches a `TerminalNode`, the flow ends with the declared `outcome`. `outcome: 'completed'` resolves the state cleanly; `outcome: 'failed'` marks the state as failed before resolving. See [`DAGBuilder.terminal()`](../guide/builder#terminal-name-outcome) for the authoring API and [Example 09: Terminal Nodes](../examples/09-terminals) for runnable examples.

---

### `PhaseNodeSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/PhaseNode`

Lifecycle-attached placement that runs outside the main DAG loop. Required: `@id`, `@type: 'PhaseNode'`, `name`, `node` (registered node reference), `phase` (enum: `pre` | `post`). No `outputs` field.

```ts twoslash
import { PhaseNodeSchema } from '@studnicky/dagonizer/entities';
import type { PhaseNodeType } from '@studnicky/dagonizer/entities';
```

`pre` placements run in declaration order before the entrypoint; an error aborts the run. `post` placements run on every exit path; errors are collected as warnings (code `POST_PHASE_FAILED`). See [Reference: Nodes](./nodes#phasenode) for the placement table.

---

### `DAGLifecycleStateSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/DAGLifecycleState`

JSON-serializable wire shape of `DAGLifecycleState`. Covers all six `variant` values with their required timestamp fields. The discriminant field is `variant` (not `kind`).

```ts twoslash
import { DAGLifecycleStateSchema } from '@studnicky/dagonizer/entities';
import type { DAGLifecycleStateDataType } from '@studnicky/dagonizer/entities';
```

---

### `CheckpointDataSchema`

`$id`: `https://noocodec.dev/schemas/dagonizer/CheckpointData`

Persistable snapshot of an in-flight DAG execution. Required: `dagName` (expanded DAG IRI), `cursor` (placement IRI or null), `state` (object), `executedNodes`, `skippedNodes`, `stores` (named-store snapshots keyed by store name; empty object when no stores were captured).

```ts twoslash
import { CheckpointDataSchema } from '@studnicky/dagonizer/entities';
import type { CheckpointDataType } from '@studnicky/dagonizer/entities';
```

---

### Node runtime schemas

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

### Execution and reporting schemas

| Schema | Derived type | Purpose |
|---|---|---|
| `ExecutionResultSchema` | `ExecutionResult` | Wire shape of `ExecutionResultType` (no narrowed `state`) |
| `ValidationResultSchema` | `ValidationResult` | Validation envelope used by node `validate()` |
| `DAGErrorJSONSchema` | `DAGErrorJSON` | JSON shape returned from `DAGError.toJSON()` |

`InterruptionInfo` (`{ nodeName: string, reason: 'abort' | 'timeout' }`) lives alongside `ExecutionResultType` and is exported from the root barrel.

### Constant value+type pairs

These constants are available from `@studnicky/dagonizer/constants` as value+type pairs. Each constant is a frozen lookup object AND a `FromSchema`-derived type with the same name. `BackoffStrategy` ships through `@studnicky/dagonizer/runtime`, not `./constants`.

<<< @/../examples/dags/constants-usage.ts#constants

Each constant is exported as a value object (plural name) paired with a type (singular name) so the JSON literal can be used as a discriminator.

| Value | Type | Members |
|---|---|---|
| `GatherStrategyNames` | `GatherStrategyName` | `'map'`, `'append'`, `'partition'`, `'custom'`, `'collect'`, `'discard'` |
| `ScatterOutputNames` | `ScatterOutput` | `'all-success'`, `'partial'`, `'all-error'`, `'empty'` |
| `MetadataKeys` | `MetadataKey` | `'currentItem'`, `'gatherResults'`, `'itemIndex'` |
| `OutputNames` | `Output` | Reserved canonical output names |
| `NodeTypes` | `NodeType` | `'embedded'`, `'scatter'`, `'gather'`, `'single'` |
| `BackoffStrategyNames` | `BackoffStrategy` | `'constant'`, `'linear'`, `'exponential'`, `'decorrelated-jitter'` |

Each constant has a matching `*Schema` JSON Schema for `oneOf`-style validation. See [Reference: Runtime](./runtime#const-backoffstrategynames-and-type-backoffstrategy) for `BackoffStrategyNames` usage details.

---

### JSON types

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

## Details for Nerds

Entity schemas are the source of truth for serialized documents. If a TypeScript type and schema ever appear to disagree, fix the schema-derived type path.

Schema `$id` values are stable identifiers for validation and tooling. They are not registry keys for node execution. Runtime DAG and placement identity comes from explicit IRIs; registered node and DAG implementation lookup uses context expansion.

## Related Concepts

- [Reference: Validation](./validation)
- [Reference: Contracts](./contracts) - interfaces narrow these entities
- [Schema and JSON Loading](../guide/schema) - loading and validating entity-backed documents
- [DAGBuilder](../guide/builder) - producing DAG entities from TypeScript
