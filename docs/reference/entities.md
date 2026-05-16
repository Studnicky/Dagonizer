# Entities

`@noocodex/dagonizer/entities`

JSON Schema constants for every shape in the package. Each schema is assigned a stable `$id` URI. TypeScript types are derived from schemas via `json-schema-to-ts`.

---

## `DAGSchema`

```ts
import { DAGSchema } from '@noocodex/dagonizer/entities';
```

`$id`: `https://noocodex.dev/schemas/dagonizer/DAG`

Top-level DAG declaration. Required properties: `name`, `version`, `entrypoint`, `nodes`. Each entry in `nodes` is validated against a `oneOf` covering all four node kinds.

```ts
import type { DAG } from '@noocodex/dagonizer/entities';
```

---

## `SingleNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/SingleNode`

Single-node placement. Required: `type: 'single'`, `name`, `node`, `outputs`.

```ts
import { SingleNodeSchema } from '@noocodex/dagonizer/entities';
import type { SingleNode } from '@noocodex/dagonizer/entities';
```

`outputs` is a `Record<string, string | null>` — each key is an output name, the value is the next node name or `null` to terminate.

---

## `ParallelNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/ParallelNode`

Concurrent node group. Required: `type: 'parallel'`, `name`, `nodes` (non-empty array of node names), `combine` (enum: `all-success` | `any-success` | `collect`), `outputs`.

```ts
import { ParallelNodeSchema } from '@noocodex/dagonizer/entities';
import type { ParallelNode } from '@noocodex/dagonizer/entities';
```

---

## `FanOutNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/FanOutNode`

Fan-out + fan-in node. Required: `type: 'fan-out'`, `name`, `node`, `source`, `fanIn`, `outputs`. Optional: `itemKey` (default `currentItem`), `concurrency` (default = source array length).

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

## `SubDAGNodeSchema`

`$id`: `https://noocodex.dev/schemas/dagonizer/SubDAGNode`

Nested DAG invocation. Required: `type: 'sub-dag'`, `name`, `dag` (registered DAG name), `outputs`. Optional: `stateMapping.input` and `stateMapping.output` (both `Record<string, string>`).

```ts
import { SubDAGNodeSchema } from '@noocodex/dagonizer/entities';
import type { SubDAGNode } from '@noocodex/dagonizer/entities';
```

`outputs` keys are `success` and `error`.

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

## See also

- [Reference: Validation](./validation)
- [Reference: Contracts](./contracts) — interfaces narrow these entities

## Related guides

- [Schema & JSON loading](../guide/schema)
- [DAGBuilder](../guide/builder)
