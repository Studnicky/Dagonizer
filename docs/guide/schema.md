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

The schema covers: `name`, `version`, `entrypoint`, and `nodes`. Each node variant (`single`, `parallel`, `fan-out`, `sub-dag`) has its own sub-schema enforcing required fields and valid enumerations for `type`, `combine`, fan-in `strategy`, and node-output values.

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

## `sharedAjv`

The package exposes the compiled Ajv instance for callers that need to add their own schemas while sharing compiled validators:

```ts
import { sharedAjv } from '@noocodex/dagonizer/validation';

sharedAjv.addSchema(myCustomSchema);
```

`sharedAjv` has `allErrors: true`, `strict: false`, and Draft 2020-12 support pre-configured.

## See also

- [DAGBuilder](./builder) — author DAGs in code instead of loading from JSON
- [Contract-derived flows](./derive) — generate the DAG topology from contracts; load is unnecessary

## Related reference

- [Reference: Validation](../reference/validation)
- [Reference: Entities](../reference/entities)
- [Reference: Errors — `ValidationError`](../reference/errors)
- [Example: Schema Loading](../examples/07-schema)
