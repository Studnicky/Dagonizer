---
seeAlso:

  - text: 'DAGBuilder'

    link: './builder'
    description: 'author DAGs in code instead of loading from JSON'

  - text: 'Contract-derived flows'

    link: './derive'
    description: 'generate the DAG topology from contracts; load is unnecessary'
---

# Schema & JSON Loading

DAG configs are plain JSON objects that are validated against `DAGSchema` (JSON Schema Draft 2020-12, compiled via Ajv) at the ingest boundary.

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

## `Dagonizer.fromValue`

Validate an already-parsed value (e.g. from a YAML parser):

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const dag = Dagonizer.fromValue(yamlParsedObject);
```

Semantically identical to `Dagonizer.load` but skips the `JSON.parse` step.

## `DAGSchema`

The schema is exported directly for callers that want to integrate with their own Ajv instance or schema registry:

```ts
import { DAGSchema } from '@noocodex/dagonizer/entities';

console.log(DAGSchema.$id);
// 'https://noocodex.dev/schemas/dagonizer/DAG'
```

The schema covers: `name`, `version`, `entrypoint`, and `nodes`. Each node variant (`single`, `parallel`, `fan-out`, `deep-dag`) has its own sub-schema enforcing required fields and valid enumerations for `type`, `combine`, fan-in `strategy`, and node-output values.

## `Validator.dag`

Lower-level validator used by `Dagonizer.load` and `registerDAG`:

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

`Dagonizer.serialize` is `JSON.stringify(dag, null, 2)`. It does not re-validate — the DAG is assumed to already be valid.

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

Validator.dag.is(x);         // type predicate — returns boolean
Validator.dag.validate(x);   // returns narrowed DAG or throws ValidationError
Validator.dag.errors(x);     // returns string[] | null (null = valid)
```

Sub-validators are compiled once at module load against the shared Ajv 2020-12 instance (`allErrors: true`, `strict: false`). Every top-level entity schema in `entities/` has a corresponding sub-validator on `Validator`.
## Related reference

- [Reference: Validation](../reference/validation)
- [Reference: Entities](../reference/entities)
- [Reference: Errors — `ValidationError`](../reference/errors)
- [Example: Schema Loading](../examples/03-schema)
