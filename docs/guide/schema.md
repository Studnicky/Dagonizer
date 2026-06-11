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

## `Dagonizer.load`

The single permitted entry point for raw external JSON:

```ts
import { Dagonizer, ValidationError } from '@noocodex/dagonizer';

try {
  const dag = Dagonizer.load(rawJsonString);
  dispatcher.registerDAG(dag);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.message); // formatted Ajv errors, one per line
  }
}
```

`Dagonizer.load` calls `JSON.parse` then validates the result against `DAGSchema`. Both JSON syntax errors and schema violations throw `ValidationError` with a human-readable message listing every failing constraint.

The Phase 03 demo exercises the validation path with a deliberately broken document:

<<< @/../examples/03-schema.ts#validate

## `Dagonizer.fromValue`

Validate an already-parsed value (a YAML parser's output, for example):

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const dag = Dagonizer.fromValue(yamlParsedObject);
```

Semantically identical to `Dagonizer.load` but skips the `JSON.parse` step.

## `DAGSchema`

The schema is exported directly for callers that want to integrate with their own schema registry:

```ts
import { DAGSchema } from '@noocodex/dagonizer/entities';

console.log(DAGSchema.$id);
// 'https://noocodex.dev/schemas/dagonizer/DAG'
```

The schema covers `name`, `version`, `entrypoint`, and `nodes`. Each node variant has its own sub-schema enforcing required fields and valid enumerations for `@type`, `combine`, gather `strategy`, and node-output values.

| `@type` | Required fields | Notes |
|---|---|---|
| `SingleNode` | `@id`, `@type`, `name`, `node`, `outputs` | `outputs` is `Record<string, string \| null>` |
| `ScatterNode` | `@id`, `@type`, `name`, `body`, `source`, `gather`, `outputs` | `body` is `{ node }` or `{ dag }`; `gather` is required; optional `itemKey`, `concurrency`, `stateMapping.input`, `reducer` |
| `EmbeddedDAGNode` | `@id`, `@type`, `name`, `dag`, `outputs` | `dag` is the registered child DAG name; optional `stateMapping` (`input` and `output` field maps) |
| `TerminalNode` | `@id`, `@type`, `name`, `outcome` | no `outputs` field; `outcome` is `'completed'` or `'failed'` |
| `PhaseNode` | `@id`, `@type`, `name`, `phase`, `node` | `phase` is `'pre'` or `'post'`; no `outputs` |

## `Validator.dag`

The lower-level validator used by `Dagonizer.load` and `registerDAG`:

```ts
import { Validator } from '@noocodex/dagonizer/validation';

// validate returns DAG or throws ValidationError
const dag = Validator.dag.validate(unknownValue);
```

`registerDAG` calls `Validator.dag.validate` as a pre-pass before the semantic checks (node and DAG cross-references).

## `Dagonizer.serialize`

Round-trip a validated DAG to JSON:

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const json = Dagonizer.serialize(dag);
const roundTripped = Dagonizer.load(json);
// JSON.stringify(roundTripped) === JSON.stringify(dag)
```

`Dagonizer.serialize` is `JSON.stringify(dag, null, 2)`. It does not re-validate; the DAG is assumed to already be valid.

`Dagonizer.serializeCompact` produces compact JSON with no whitespace.

## `ValidationError`

`ValidationError` extends `DAGError` and is thrown for schema violations:

```ts
import { ValidationError } from '@noocodex/dagonizer';

try {
  Dagonizer.load('{ "name": "broken" }');
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.code);    // 'VALIDATION_ERROR'
    console.error(error.message); // multi-line Ajv failure list
  }
}
```

Each Ajv failure is formatted as `<instancePath>: <message>` on a separate line.

## `Validator` sub-validators

`Validator` exposes one `EntityValidator<T>` per entity schema. Each sub-validator has three methods:

```ts
import { Validator } from '@noocodex/dagonizer/validation';

Validator.dag.is(x);         // type predicate, returns boolean
Validator.dag.validate(x);   // returns narrowed DAG or throws ValidationError
Validator.dag.errors(x);     // returns string[] | null (null means valid)
```

Sub-validators are compiled once at module load against the shared Ajv 2020-12 instance (`allErrors: true`, `strict: false`). Every top-level entity schema in `entities/` has a corresponding sub-validator on `Validator`, including `Validator.terminalNode` for `TerminalNodeSchema`:

```ts
import { Validator } from '@noocodex/dagonizer/validation';

Validator.terminalNode.is(x);       // type predicate
Validator.terminalNode.validate(x); // returns TerminalNode or throws ValidationError
Validator.terminalNode.errors(x);   // returns string[] | null
```

Re-validating a value calls the precompiled function. There is no Ajv setup cost per call.

## Related reference

- [Phase 03, Schema loading demo](../examples/03-schema)
- [Reference, Validation](../reference/validation)
- [Reference, Entities](../reference/entities)
- [Reference, Errors, `ValidationError`](../reference/errors)
