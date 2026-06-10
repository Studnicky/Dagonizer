---
seeAlso:
  - text: 'Reference: Entities'
    link: './entities'
    description: 'every schema `Validator` exposes'
  - text: 'Reference: Errors'
    link: './errors'
    description: '`ValidationError`'
---

# Validation

`@noocodex/dagonizer/validation`

The validation module provides the Ajv instance and the unified entity validator used internally by the dispatcher.

---

## Class: `Validator`

Unified Ajv-backed entity validator. Access per-entity sub-validators via static fields.

```ts
import { Validator } from '@noocodex/dagonizer/validation';
```

### `Validator.dag`

Type: `EntityValidator<DAG>`

Validates raw values against `DAGSchema` (Ajv 2020-12). Used internally by `Dagonizer.load`, `Dagonizer.fromValue`, and `Dagonizer.registerDAG`.

#### `Validator.dag.validate(value)`

```ts
Validator.dag.validate(value: unknown): DAG
```

Validates `value` against `DAGSchema`. Returns a typed `DAG` on success. Throws `ValidationError` with a multi-line message listing every Ajv failure on error.

```ts
<<< @/../examples/03-schema.ts#validate
```

#### `Validator.dag.is(value)`

```ts
Validator.dag.is(value: unknown): value is DAG
```

Type predicate. Returns `true` when `value` satisfies `DAGSchema`.

#### `Validator.dag.errors(value)`

```ts
Validator.dag.errors(value: unknown): string[] | null
```

Returns formatted `path: message` error strings, or `null` if valid.

---

### `Validator.checkpoint`

Type: `EntityValidator<CheckpointData>`

Validates raw values against `CheckpointDataSchema`. Used by `Checkpoint.load`.

```ts
Validator.checkpoint.validate(value: unknown): CheckpointData
```

Returns a typed `CheckpointData` or throws `ValidationError`. Called by `Checkpoint.load` before any field access.

---

### Other validators

Every JSON Schema in `@noocodex/dagonizer/entities` has a matching static `EntityValidator` on `Validator`. Names use camelCase derived from the schema name.

| Field | Entity | Schema |
|---|---|---|
| `Validator.dag` | `DAG` | `DAGSchema` |
| `Validator.singleNode` | `SingleNode` | `SingleNodeSchema` |
| `Validator.scatterNode` | `ScatterNode` | `ScatterNodeSchema` |
| `Validator.embeddedDAGNode` | `EmbeddedDAGNode` | `EmbeddedDAGNodeSchema` |
| `Validator.terminalNode` | `TerminalNode` | `TerminalNodeSchema` |
| `Validator.phaseNode` | `PhaseNode` | `PhaseNodeSchema` |
| `Validator.gatherConfig` | `GatherConfig` | `GatherConfigSchema` |
| `Validator.node` | `Node` | `NodeSchema` |
| `Validator.nodeContext` | `NodeContext` | `NodeContextSchema` |
| `Validator.nodeOutput` | `NodeOutput` | `NodeOutputSchema` |
| `Validator.nodeError` | `NodeError` | `NodeErrorSchema` |
| `Validator.nodeWarning` | `NodeWarning` | `NodeWarningSchema` |
| `Validator.nodeResult` | `NodeResult` | `NodeResultSchema` |
| `Validator.nodeStateData` | `NodeStateData` | `NodeStateDataSchema` |
| `Validator.executionResult` | `ExecutionResult` | `ExecutionResultSchema` |
| `Validator.dagLifecycleState` | `DAGLifecycleStateData` | `DAGLifecycleStateSchema` |
| `Validator.checkpoint` | `CheckpointData` | `CheckpointDataSchema` |
| `Validator.validationResult` | `ValidationResult` | `ValidationResultSchema` |
| `Validator.dagErrorJson` | `DAGErrorJSON` | `DAGErrorJSONSchema` |

Every entry exposes the same `EntityValidator<T>` surface: `is(value)`, `validate(value)`, `errors(value)`.

---

## `EntityValidator<T>`

Per-entity validator interface. Every `Validator.<entity>` field is an `EntityValidator`.

```ts
import type { EntityValidator } from '@noocodex/dagonizer/validation';
```

```ts
interface EntityValidator<T> {
  is(value: unknown): value is T;
  validate(value: unknown): T;
  errors(value: unknown): string[] | null;
}
```
## Related guides

- [Schema & JSON loading](../guide/schema)
- [Persistence](../guide/persistence): `Validator.checkpoint` runs inside `Checkpoint.recall`
