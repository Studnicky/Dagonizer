---
title: 'Schema and JSON Loading'
description: 'DAG configs are JSON objects validated against DAGSchema (JSON Schema 2020-12) at the ingest boundary. Validator sub-validators are Ajv-compiled once at module load; applications call Validator.dag.validate(x), never building their own Ajv against the package schemas.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'author DAGs in code instead of loading from JSON'
  - text: 'JSON-LD export and import'
    link: './json-ld'
    description: 'serialize, load, and round-trip a DAG document'
  - text: 'Entities'
    link: '../reference/entities'
    description: 'every schema and its derived type'
nextSteps:
  - text: 'Example 03: Tool Schemas'
    link: '../examples/03-schema'
    description: 'runnable load-and-validate example'
---

<script setup lang="ts">
import { dag as schemaDag } from '../../examples/dags/03-schema.ts';
</script>

# Schema and JSON Loading

## What It Is

Schema loading is the guardrail between untrusted JSON and the dispatcher registry. A DAG can arrive from a plugin package, config file, database row, or generated artifact; `DAGDocument.load` accepts it only after the JSON parses and the document satisfies `DAGSchema`.

The schema is the same contract the builder emits. That keeps code-authored DAGs, serialized JSON-LD DAGs, docs diagrams, and runtime execution on one shape.

## How It Works

`DAGDocument.load` parses raw JSON, validates it against `DAGSchema`, and returns a typed `DAG` only after every placement satisfies its schema. `DAGDocument.ofValue` validates already-parsed input. `Validator` exposes the same precompiled Ajv validators for lower-level entity checks.

`DAGSchema` describes the canonical DAG wire shape in JSON Schema 2020-12. The Ajv 2020-12 instance that validates against it is compiled once at module load and exposed through `Validator.dag`. Application code calls `Validator.dag.validate(x)`; it does not need to build a fresh Ajv instance against the package schemas.

## Diagrams, Examples, and Outputs

Example 03 starts with a JSON-LD string, validates it, registers the loaded DAG, and runs it. The JSON-LD and diagram are generated from that same example source:

<<< @/../examples/dags/03-schema.ts#dag-literal

<<< @/../examples/dags/03-schema.ts#load

<DagJsonMermaid :dag="schemaDag" title="Example 03 schema-loaded DAG" aria-label="Example 03 schema-loaded JSON-LD DAG beside Mermaid generated from it." />

Use these pages together:

- [Example 03: Tool Schemas](../examples/03-schema) runs the load, validation, and round-trip path.
- [JSON-LD Export and Import](./json-ld) explains the serialized wire format.
- [DAGBuilder](./builder) explains the code path that emits the same schema-valid DAG shape.
- [Reference: Entities](../reference/entities) lists every schema-derived entity type.

## What It Lets You Do

### Use when

Use schema loading when a DAG document comes from outside trusted TypeScript source: a plugin package, config file, database row, user upload, or generated artifact. Validation is the boundary that keeps malformed JSON-LD out of the dispatcher registry.

## Code Samples

### `DAGSchema`

The schema is exported directly for callers that want to integrate with their own schema registry:

<<< @/../examples/03-schema.ts#schema-id

The schema covers `name`, `version`, `entrypoint`, and `nodes`. Each node variant has its own sub-schema enforcing required fields and valid enumerations for `@type`, `combine`, gather `strategy`, and node-output values.

| `@type` | Required fields | Notes |
|---|---|---|
| `SingleNode` | `@id`, `@type`, `name`, `node`, `outputs` | `outputs` is `Record<string, string \| null>` |
| `ScatterNode` | `@id`, `@type`, `name`, `body`, `source`, `gather`, `outputs` | `body` is `{ node }` or `{ dag }`; `gather` is required; optional `itemKey`, `execution` (unified concurrency-limiting policy), `stateMapping.input`, `reducer` |
| `EmbeddedDAGNode` | `@id`, `@type`, `name`, `dag`, `outputs` | `dag` is the registered child DAG name; optional `stateMapping` (`input` and `output` field maps) |
| `TerminalNode` | `@id`, `@type`, `name`, `outcome` | no `outputs` field; `outcome` is `'completed'` or `'failed'` |
| `PhaseNode` | `@id`, `@type`, `name`, `phase`, `node` | `phase` is `'pre'` or `'post'`; no `outputs` |

## Details for Nerds

### `DAGDocument.load`

The single permitted entry point for raw external JSON:

<<< @/../examples/03-schema.ts#load-and-register

`DAGDocument.load` calls `JSON.parse` then validates the result against `DAGSchema`. Both JSON syntax errors and schema violations throw `ValidationError` with a human-readable message listing every failing constraint.

Example 03 exercises the validation path with a deliberately broken document:

<<< @/../examples/03-schema.ts#validate

### `DAGDocument.ofValue`

Validate an already-parsed value (a YAML parser's output, for example):

<<< @/../examples/03-schema.ts#from-value

Semantically identical to `DAGDocument.load` but skips the `JSON.parse` step.

### `Validator.dag`

The lower-level validator used by `DAGDocument.load` and `registerDAG`:

<<< @/../examples/03-schema.ts#validator-validate

`registerDAG` calls `Validator.dag.validate` as a pre-pass before the semantic checks (node and DAG cross-references).

### `DAGDocument.serialize`

Round-trip a validated DAG to JSON:

<<< @/../examples/03-schema.ts#serialize-roundtrip

`DAGDocument.serialize` is `JSON.stringify(dag, null, 2)`. It does not re-validate; the DAG is assumed to already be valid.

`DAGDocument.serializeCompact` produces compact JSON with no whitespace.

### `ValidationError`

`ValidationError` extends `DAGError` and is thrown for schema violations:

<<< @/../examples/03-schema.ts#validation-error

Each Ajv failure is formatted as `<instancePath>: <message>` on a separate line.

### `Validator` sub-validators

`Validator` exposes one `EntityValidator<T>` per entity schema. Each sub-validator has three methods:

<<< @/../examples/03-schema.ts#validator-methods

Sub-validators are compiled once at module load against the shared Ajv 2020-12 instance (`allErrors: true`, `strict: false`). Every top-level entity schema in `entities/` has a corresponding sub-validator on `Validator`, including `Validator.terminalNode` for `TerminalNodeSchema`:

<<< @/../examples/03-schema.ts#validator-terminal

Re-validating a value calls the precompiled function. There is no Ajv setup cost per call.

## Related Concepts

- [DAGBuilder](./builder) - author DAGs in code instead of loading from JSON
- [JSON-LD export and import](./json-ld) - serialize, load, and round-trip a DAG document
- [Entities](../reference/entities) - every schema and its derived type
- [Example 03: Tool Schemas](../examples/03-schema) - runnable load-and-validate example
- [Reference, Validation](../reference/validation)
- [Reference, Entities](../reference/entities)
- [Reference, Errors, `ValidationError`](../reference/errors)
