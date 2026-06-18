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

```ts twoslash
import { Validator } from '@noocodex/dagonizer/validation';
```

### `Validator.dag`

Type: `EntityValidator<DAG>`

Validates raw values against `DAGSchema` (Ajv 2020-12). Used internally by `Dagonizer.load`, `Dagonizer.fromValue`, and `Dagonizer.registerDAG`.

#### `Validator.dag.validate(value)`

```ts twoslash
import { Validator } from '@noocodex/dagonizer/validation';
import type { DAG } from '@noocodex/dagonizer/entities';
// ---cut---
declare const raw: unknown;
const dag: DAG = Validator.dag.validate(raw);
```

Validates `value` against `DAGSchema`. Returns a typed `DAG` on success. Throws `ValidationError` with a multi-line message listing every Ajv failure on error.

#### `Validator.dag.is(value)`

```ts twoslash
import { Validator } from '@noocodex/dagonizer/validation';
import type { DAG } from '@noocodex/dagonizer/entities';
// ---cut---
declare const raw: unknown;
if (Validator.dag.is(raw)) {
  const dag: DAG = raw;
}
```

Type predicate. Returns `true` when `value` satisfies `DAGSchema`.

#### `Validator.dag.errors(value)`

```ts twoslash
import { Validator } from '@noocodex/dagonizer/validation';
// ---cut---
declare const raw: unknown;
const errs: string[] | null = Validator.dag.errors(raw);
```

Returns formatted `path: message` error strings, or `null` if valid.

---

### `Validator.checkpoint`

Type: `EntityValidator<CheckpointData>`

Validates raw values against `CheckpointDataSchema`. Used by `Checkpoint.load`.

```ts twoslash
import { Validator } from '@noocodex/dagonizer/validation';
import type { CheckpointData } from '@noocodex/dagonizer/entities';
// ---cut---
declare const raw: unknown;
const data: CheckpointData = Validator.checkpoint.validate(raw);
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

```ts twoslash
import type { EntityValidator } from '@noocodex/dagonizer/validation';
// EntityValidator<T>:
//   is(value: unknown): value is T
//   validate(value: unknown): T
//   errors(value: unknown): string[] | null
declare const _v: EntityValidator<unknown>;
```
## Related guides

- [Schema & JSON loading](../guide/schema)
- [Persistence](../guide/persistence): `Validator.checkpoint` runs inside `Checkpoint.recall`
