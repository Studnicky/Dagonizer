---
title: 'Schema and JSON loading'
description: 'DAG configs are JSON objects validated against DAGSchema (JSON Schema 2020-12) at the ingest boundary. Validator sub-validators are Ajv-compiled once at module load; consumers call Validator.dag.validate(x), never building their own Ajv against the package schemas.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'author DAGs in code instead of loading from JSON'
  - text: 'JSON-LD export and import'
    link: './json-ld'
    description: 'serialize, load, and round-trip a DAG document'
  - text: 'Contract-derived flows'
    link: './derive'
    description: 'generate the DAG topology from contracts; load is unnecessary'
  - text: 'Entities'
    link: '../reference/entities'
    description: 'every schema and its derived type'
nextSteps:
  - text: 'Phase 03, Schema loading demo'
    link: '../examples/03-schema'
    description: 'runnable load-and-validate example'
---

# Schema and JSON loading

`DAGSchema` describes the canonical DAG wire shape in JSON Schema 2020-12. The Ajv 2020-12 instance that validates against it is compiled once at module load and exposed through `Validator.dag`. Consumers call `Validator.dag.validate(x)`; they never build a fresh Ajv against the package's schemas.

## `DAGDocument.load`

The single permitted entry point for raw external JSON:

<<< @/../examples/03-schema.ts#load-and-register

`DAGDocument.load` calls `JSON.parse` then validates the result against `DAGSchema`. Both JSON syntax errors and schema violations throw `ValidationError` with a human-readable message listing every failing constraint.

The Phase 03 demo exercises the validation path with a deliberately broken document:

<<< @/../examples/03-schema.ts#validate

## `DAGDocument.fromValue`

Validate an already-parsed value (a YAML parser's output, for example):

<<< @/../examples/03-schema.ts#from-value

Semantically identical to `DAGDocument.load` but skips the `JSON.parse` step.

## `DAGSchema`

The schema is exported directly for callers that want to integrate with their own schema registry:

<<< @/../examples/03-schema.ts#schema-id

The schema covers `name`, `version`, `entrypoint`, and `nodes`. Each node variant has its own sub-schema enforcing required fields and valid enumerations for `@type`, `combine`, gather `strategy`, and node-output values.

| `@type` | Required fields | Notes |
|---|---|---|
| `SingleNode` | `@id`, `@type`, `name`, `node`, `outputs` | `outputs` is `Record<string, string \| null>` |
| `ScatterNode` | `@id`, `@type`, `name`, `body`, `source`, `gather`, `outputs` | `body` is `{ node }` or `{ dag }`; `gather` is required; optional `itemKey`, `concurrency`, `stateMapping.input`, `reducer` |
| `EmbeddedDAGNode` | `@id`, `@type`, `name`, `dag`, `outputs` | `dag` is the registered child DAG name; optional `stateMapping` (`input` and `output` field maps) |
| `TerminalNode` | `@id`, `@type`, `name`, `outcome` | no `outputs` field; `outcome` is `'completed'` or `'failed'` |
| `PhaseNode` | `@id`, `@type`, `name`, `phase`, `node` | `phase` is `'pre'` or `'post'`; no `outputs` |

## `Validator.dag`

The lower-level validator used by `DAGDocument.load` and `registerDAG`:

<<< @/../examples/03-schema.ts#validator-validate

`registerDAG` calls `Validator.dag.validate` as a pre-pass before the semantic checks (node and DAG cross-references).

## `DAGDocument.serialize`

Round-trip a validated DAG to JSON:

<<< @/../examples/03-schema.ts#serialize-roundtrip

`DAGDocument.serialize` is `JSON.stringify(dag, null, 2)`. It does not re-validate; the DAG is assumed to already be valid.

`DAGDocument.serializeCompact` produces compact JSON with no whitespace.

## `ValidationError`

`ValidationError` extends `DAGError` and is thrown for schema violations:

<<< @/../examples/03-schema.ts#validation-error

Each Ajv failure is formatted as `<instancePath>: <message>` on a separate line.

## `Validator` sub-validators

`Validator` exposes one `EntityValidator<T>` per entity schema. Each sub-validator has three methods:

<<< @/../examples/03-schema.ts#validator-methods

Sub-validators are compiled once at module load against the shared Ajv 2020-12 instance (`allErrors: true`, `strict: false`). Every top-level entity schema in `entities/` has a corresponding sub-validator on `Validator`, including `Validator.terminalNode` for `TerminalNodeSchema`:

<<< @/../examples/03-schema.ts#validator-terminal

Re-validating a value calls the precompiled function. There is no Ajv setup cost per call.

## Related reference

- [Phase 03, Schema loading demo](../examples/03-schema)
- [Reference, Validation](../reference/validation)
- [Reference, Entities](../reference/entities)
- [Reference, Errors, `ValidationError`](../reference/errors)
