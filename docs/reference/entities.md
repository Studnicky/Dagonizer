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

```ts
import { DAGSchema } from '@noocodex/dagonizer/entities';
```

`$id`: `https://noocodex.dev/schemas/dagonizer/DAG`

Top-level DAG declaration in JSON-LD 1.1 canonical form. Required properties: `@context`, `@id`, `@type: 'DAG'`, `name`, `version`, `entrypoint`, `nodes`. Each entry in `nodes` is validated against a `oneOf` covering every placement kind (`SingleNode`, `ParallelNode`, `FanOutNode`, `EmbeddedDAGNode`, `TerminalNode`, `PhaseNode`).

```ts
import type { DAG } from '@noocodex/dagonizer/entities';
```

---

## `SingleNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/SingleNode`

Single-node placement. Required: `@id`, `@type: 'SingleNode'`, `name`, `node`, `outputs`.

```ts
import { SingleNodeSchema } from '@noocodex/dagonizer/entities';
import type { SingleNode } from '@noocodex/dagonizer/entities';
```

`outputs` is a `Record<string, string | null>`: each key is an output name, the value is the next node name or `null` to terminate.

---

## `ParallelNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/ParallelNode`

Concurrent node group. Required: `@id`, `@type: 'ParallelNode'`, `name`, `nodes` (non-empty array of node names), `combine` (enum: `all-success` | `any-success` | `collect`), `outputs`.

```ts
import { ParallelNodeSchema } from '@noocodex/dagonizer/entities';
import type { ParallelNode } from '@noocodex/dagonizer/entities';
```

---

## `FanOutNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/FanOutNode`

Fan-out + fan-in node. Required: `@id`, `@type: 'FanOutNode'`, `name`, `node`, `source`, `fanIn`, `outputs`. Optional: `itemKey` (default `currentItem`), `concurrency` (default = source array length).

```ts
import { FanOutNodeSchema } from '@noocodex/dagonizer/entities';
import type { FanOutNode } from '@noocodex/dagonizer/entities';
```

`outputs` keys are the aggregate results: `all-success`, `partial`, `all-error`, `empty`.

---

## `FanInConfigSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/FanInConfig`

Fan-in strategy configuration for fan-out nodes. Required: `strategy` (enum: `append` | `partition` | `custom`). Strategy-specific required fields:

| Strategy | Additional required |
|----------|-------------------|
| `append` | `target: string` (dotted path) |
| `partition` | `partitions: Record<outputName, targetPath>` |
| `custom` | `customNode: string` (registered node name) |

```ts
import { FanInConfigSchema } from '@noocodex/dagonizer/entities';
import type { FanInConfig } from '@noocodex/dagonizer/entities';
```

---

## `EmbeddedDAGNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/EmbeddedDAGNode`

Nested DAG invocation. Required: `@id`, `@type: 'EmbeddedDAGNode'`, `name`, `dag` (registered DAG name), `outputs`. Optional: `stateMapping.input` and `stateMapping.output` (both `Record<string, string>`).

```ts
import { EmbeddedDAGNodeSchema } from '@noocodex/dagonizer/entities';
import type { EmbeddedDAGNode } from '@noocodex/dagonizer/entities';
```

`outputs` keys are `success` and `error`.

---

## `TerminalNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/TerminalNode`

Explicit terminal placement. Required: `@id`, `@type: 'TerminalNode'`, `name`, `outcome` (enum: `completed` | `failed`). No `outputs` field. TerminalNodes are leaves.

```ts
import { TerminalNodeSchema } from '@noocodex/dagonizer/entities';
import type { TerminalNode } from '@noocodex/dagonizer/entities';
```

When the engine reaches a `TerminalNode`, the flow ends with the declared `outcome`. `outcome: 'completed'` resolves the state cleanly; `outcome: 'failed'` marks the state as failed before resolving. See [`DAGBuilder.terminal()`](../guide/builder#terminal-name-outcome) for the authoring API and [Phase 09 · Terminal placements](../examples/09-terminals) for runnable examples.

---

## `PhaseNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/PhaseNode`

Lifecycle-attached placement that runs outside the main DAG loop. Required: `@id`, `@type: 'PhaseNode'`, `name`, `node` (registered node name), `phase` (enum: `pre` | `post`). No `outputs` field.

```ts
import { PhaseNodeSchema } from '@noocodex/dagonizer/entities';
import type { PhaseNode } from '@noocodex/dagonizer/entities';
```

`pre` placements run in declaration order before the entrypoint; an error aborts the run. `post` placements run on every exit path; errors are collected as warnings (code `POST_PHASE_FAILED`). See [Reference: Nodes](./nodes#phasenode) for the placement table.

---

## `DAGLifecycleStateSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/DAGLifecycleState`

JSON-serializable wire shape of `DAGLifecycleState`. Covers all six `kind` variants with their required timestamp fields.

```ts
import { DAGLifecycleStateSchema } from '@noocodex/dagonizer/entities';
import type { DAGLifecycleStateData } from '@noocodex/dagonizer/entities';
```

---

## `CheckpointDataSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/CheckpointData`

Persistable snapshot of an in-flight DAG execution. Required: `version`, `dagName`, `cursor` (string or null), `state` (object), `executedNodes`, `skippedNodes`.

```ts
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

```ts
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

Constants are exported with paired value and type so the JSON literal can be used as a discriminator.

| Constant | Members |
|---|---|
| `FanInStrategyName` | `'append'`, `'partition'`, `'custom'` |
| `FanOutOutput` | `'all-success'`, `'partial'`, `'all-error'`, `'empty'` |
| `MetadataKey` | Reserved metadata key constants |
| `Output` | Reserved canonical output names |
| `ParallelCombine` | `'all-success'`, `'any-success'`, `'collect'` |
| `NodeType` | `'SingleNode'`, `'ParallelNode'`, `'FanOutNode'`, `'EmbeddedDAGNode'`, `'TerminalNode'`, `'PhaseNode'` |
| `BackoffStrategy` | `'constant'`, `'linear'`, `'exponential'`, `'decorrelated-jitter'` |

Each constant has a matching `*Schema` JSON Schema for `oneOf`-style validation. See [Reference: Runtime](./runtime#const-backoffstrategy) for `BackoffStrategy` usage details.

---

## JSON types

```ts
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
