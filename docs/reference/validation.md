---
title: 'Validation'
description: 'Validation reference for Validator, entity validators, DAG and checkpoint validation, schema compilation, and EntityValidatorInterface.'
seeAlso:
  - text: 'Reference: Entities'
    link: './entities'
    description: 'every schema `Validator` exposes'
  - text: 'Reference: Errors'
    link: './errors'
    description: '`ValidationError`'
---

# Validation

## What It Is

The validation surface exposes the Ajv-backed validators Dagonizer uses for DAG documents, checkpoint payloads, and entity shapes.

Use this page when loading external JSON, accepting plugin DAG documents, validating generated DAGs, checking checkpoint payloads, or building tooling that should fail with the same schema errors as the dispatcher.

## How It Works

Structural validation happens at ingest boundaries: `DAGDocument.load(json)`, checkpoint loading, and explicit `Validator.*` calls. Semantic validation happens later when a dispatcher registers a DAG against its node and DAG registries.

That split matters: schema validation proves the document shape is legal; registration proves registry bindings exist and placement-IRI routes are coherent.

## Diagrams, Examples, and Outputs

Validation is not a graph renderer, but it protects every graph before execution. These pages show the related schemas and error shapes:

- [Reference: Entities](./entities) - every schema `Validator` exposes
- [Reference: Errors](./errors) - `ValidationError`

## What It Lets You Do

The validation reference lets applications run the same schema validators the dispatcher uses before registering DAGs or accepting external JSON.

`@studnicky/dagonizer/validation`

The validation module provides the Ajv instance and the unified entity validator used internally by the dispatcher.

## Code Samples

The code below covers `Validator`, entity-specific validators, `EntityValidatorInterface`, DAG validation, and checkpoint validation.

### Import

```ts twoslash
import { Validator } from '@studnicky/dagonizer/validation';
import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
```

---

### Class: `Validator`

Unified Ajv-backed entity validator. Access per-entity sub-validators via static fields.

```ts twoslash
import { Validator } from '@studnicky/dagonizer/validation';
```

#### `Validator.dag`

Type: `EntityValidatorInterface<DAG>`

Validates raw values against `DAGSchema` (Ajv 2020-12). Used internally by `DAGDocument.load(json)` and DAG registration validation paths.

##### `Validator.dag.validate(value)`

```ts twoslash
import { Validator } from '@studnicky/dagonizer/validation';
import type { DAGType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const raw: unknown;
const dag: DAGType = Validator.dag.validate(raw);
```

Validates `value` against `DAGSchema`. Returns a typed `DAGType` on success. Throws `ValidationError` with a multi-line message listing every Ajv failure on error.

##### `Validator.dag.is(value)`

```ts twoslash
import { Validator } from '@studnicky/dagonizer/validation';
import type { DAGType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const raw: unknown;
if (Validator.dag.is(raw)) {
  const dag: DAGType = raw;
}
```

Type predicate. Returns `true` when `value` satisfies `DAGSchema`.

##### `Validator.dag.errors(value)`

```ts twoslash
import { Validator } from '@studnicky/dagonizer/validation';
// ---cut---
declare const raw: unknown;
const errs: string[] | null = Validator.dag.errors(raw);
```

Returns formatted `path: message` error strings, or `null` if valid.

---

#### `Validator.checkpoint`

Type: `EntityValidatorInterface<CheckpointData>`

Validates raw values against `CheckpointDataSchema`. Used by `Checkpoint.load`.

```ts twoslash
import { Validator } from '@studnicky/dagonizer/validation';
import type { CheckpointDataType } from '@studnicky/dagonizer/entities';
// ---cut---
declare const raw: unknown;
const data: CheckpointDataType = Validator.checkpoint.validate(raw);
```

Returns a typed `CheckpointData` or throws `ValidationError`. Called by `Checkpoint.load` before any field access.

---

#### Other validators

Every JSON Schema in `@studnicky/dagonizer/entities` has a matching static `EntityValidatorInterface` on `Validator`. Names use camelCase derived from the schema name.

| Field | Entity | Schema |
|---|---|---|
| `Validator.dag` | `DAG` | `DAGSchema` |
| `Validator.singleNode` | `SingleNode` | `SingleNodeSchema` |
| `Validator.scatterNode` | `ScatterNode` | `ScatterNodeSchema` |
| `Validator.gatherNode` | `GatherNode` | `GatherNodeSchema` |
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

Every entry exposes the same `EntityValidatorInterface<T>` surface: `is(value)`, `validate(value)`, `errors(value)`.

---

### `EntityValidatorInterface<T>`

Per-entity validator interface. Every `Validator.<entity>` field is an `EntityValidatorInterface`.

```ts twoslash
import type { EntityValidatorInterface } from '@studnicky/dagonizer/validation';
// EntityValidatorInterface<T>:
//   is(value: unknown): value is T
//   validate(value: unknown): T
//   errors(value: unknown): string[] | null
declare const _v: EntityValidatorInterface<unknown>;
```

## Details for Nerds

`validate(value)` returns the typed value or throws `ValidationError`. `is(value)` is a predicate for control flow. `errors(value)` gives formatted messages without throwing.

Schema validation cannot prove registry references resolve in a dispatcher. Use validation for document shape, then `registerDAG` for semantic checks against registered nodes, DAGs, state factories, containers, channels, and placement-IRI topology.

## Related Concepts

- [Reference: Entities](./entities) - every schema `Validator` exposes
- [Reference: Errors](./errors) - `ValidationError`
- [Schema and JSON Loading](../guide/schema) - loading and validating DAG documents
- [Persistence](../guide/persistence) - `Validator.checkpoint` inside `Checkpoint.recall`
