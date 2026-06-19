---
seeAlso:
  - text: 'Reference: Validation'
    link: './validation'
  - text: 'Reference: Entities'
    link: './entities'
    description: '`DAGErrorJSON`'
---

# Errors

`@studnicky/dagonizer/errors`

All errors thrown by the dispatcher are `DAGError` instances or subclasses. They carry a `code` string, an ISO timestamp, and an optional `context` record for structured logging.

---

## Class: `DAGError`

Base error class. Extends `Error`.

```ts twoslash
import { DAGError } from '@studnicky/dagonizer';
```

### Constructor

```ts twoslash
import { DAGError } from '@studnicky/dagonizer';
// ---cut---
new DAGError('something failed', {
  code: 'DAG_ERROR',               // default: 'DAG_ERROR'
  context: { flowName: 'my-flow' },
  cause: new Error('root cause'),  // cause chaining
});
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | `'DAGError'` |
| `code` | `string` | Error classification code |
| `timestamp` | `Date` | Wall-clock timestamp at construction |
| `context` | `Record<string, unknown>` | Structured context payload |
| `cause` | `Error \| undefined` | Chained cause |

### `toJSON()`

```ts twoslash
import { DAGError } from '@studnicky/dagonizer';
// ---cut---
const error = new DAGError('something failed', { context: { flowName: 'my-flow' } });
console.log(JSON.stringify(error.toJSON(), null, 2));
```

Returns a JSON-safe representation with all fields including `stack` (if present) and a normalized `cause` shape.

---

## Class: `ConfigurationError`

Thrown when flow or node configuration is invalid (registration time).

```ts twoslash
import { ConfigurationError } from '@studnicky/dagonizer';
```

`code`: `'CONFIGURATION_ERROR'`

Typically thrown by `registerNode` when `validate()` returns `{ valid: false }`.

---

## Class: `ExecutionError`

Thrown during flow execution when the dispatcher encounters an unrecoverable runtime condition.

```ts twoslash
import { ExecutionError } from '@studnicky/dagonizer';
```

`code`: `'EXECUTION_ERROR'`

---

## Class: `NotFoundError`

Thrown when a referenced node or flow is not found during execution.

```ts twoslash
import { NotFoundError } from '@studnicky/dagonizer';
```

`code`: `'NOT_FOUND_ERROR'`

---

## Class: `ValidationError`

Thrown when schema validation fails (e.g. `DAGSchema` or `CheckpointDataSchema`).

```ts twoslash
import { ValidationError } from '@studnicky/dagonizer';
```

`code`: `'VALIDATION_ERROR'`

The `message` contains every Ajv failure formatted as `<instancePath>: <message>`, one per line.

```ts
<<< @/../examples/03-schema.ts#validate
```

---

## Class: `NodeTimeoutError`

Thrown when a node's per-node `timeoutMs` budget expires.

```ts twoslash
import { NodeTimeoutError } from '@studnicky/dagonizer';
```

`code`: `'NODE_TIMEOUT'`

### Additional properties

| Property | Type | Description |
|----------|------|-------------|
| `nodeName` | `string` | Name of the node that timed out |
| `timeoutMs` | `number` | The budget that elapsed (ms) |

### Constructor

```ts twoslash
import { NodeTimeoutError } from '@studnicky/dagonizer';
// ---cut---
new NodeTimeoutError('my-node', 5000, { cause: new Error('root') });
```

---

## Interface: `DAGErrorInterface`

Structural shape of `DAGError` for callers that need to accept it without a class reference:

```ts twoslash
import type { DAGErrorInterface } from '@studnicky/dagonizer';
// DAGErrorInterface extends Error and carries:
//   readonly code: string
//   readonly timestamp: Date
//   readonly context: Record<string, unknown>   (always present, never undefined)
//   readonly cause?: Error
const _check: DAGErrorInterface = {} as DAGErrorInterface;
```

---

## Interface: `DAGErrorJSON`

Shape returned by `DAGError.toJSON()`:

```ts twoslash
import type { DAGErrorJSONType } from '@studnicky/dagonizer';
// DAGErrorJSONType (schema-derived; all fields required):
//   name: string
//   message: string
//   code: string
//   timestamp: string               // ISO 8601
//   stack: string | null            // null when unavailable
//   context: Record<string, unknown>
//   cause: { name: string; message: string; stack: string | null } | null
const _check: DAGErrorJSONType = {} as DAGErrorJSONType;
```

---

## Error hierarchy

```
Error
└── DAGError              ('DAG_ERROR')
    ├── ConfigurationError ('CONFIGURATION_ERROR')
    ├── ExecutionError     ('EXECUTION_ERROR')
    ├── NodeTimeoutError   ('NODE_TIMEOUT')
    ├── NotFoundError      ('NOT_FOUND_ERROR')
    └── ValidationError    ('VALIDATION_ERROR')
```

All subclasses inherit `toJSON()` and the `context`/`timestamp` properties from `DAGError`.
## Related guides

- [Schema & JSON loading](../guide/schema)
- [Subclassing State](../guide/subclassing)
