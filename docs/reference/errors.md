---
seeAlso:
  - text: 'Reference: Validation'
    link: './validation'
  - text: 'Reference: Entities — `DAGErrorJSON`'
    link: './entities'
---

# Errors

`@noocodex/dagonizer/errors`

All errors thrown by the dispatcher are `DAGError` instances or subclasses. They carry a `code` string, an ISO timestamp, and an optional `context` record for structured logging.

---

## Class: `DAGError`

Base error class. Extends `Error`.

```ts
import { DAGError } from '@noocodex/dagonizer';
```

### Constructor

```ts
new DAGError(
  message: string,
  code?: string,           // default: 'DAG_ERROR'
  context?: Record<string, unknown>,
  options?: ErrorOptions,  // cause chaining
)
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | `'DAGError'` |
| `code` | `string` | Error classification code |
| `timestamp` | `Date` | Wall-clock timestamp at construction |
| `context` | `Record<string, unknown> \| undefined` | Structured context payload |
| `cause` | `unknown` | Chained cause (from `ErrorOptions`) |

### `toJSON()`

```ts
toJSON(): DAGErrorJSON
```

Returns a JSON-safe representation with all fields including `stack` (if present) and a normalized `cause` shape.

```ts
const error = new DAGError('something failed', 'DAG_ERROR', { flowName: 'my-flow' });
console.log(JSON.stringify(error.toJSON(), null, 2));
```

---

## Class: `ConfigurationError`

Thrown when flow or node configuration is invalid (registration time).

```ts
import { ConfigurationError } from '@noocodex/dagonizer';
```

`code`: `'CONFIGURATION_ERROR'`

Typically thrown by `registerNode` when `validate()` returns `{ valid: false }`.

---

## Class: `ExecutionError`

Thrown during flow execution when the dispatcher encounters an unrecoverable runtime condition.

```ts
import { ExecutionError } from '@noocodex/dagonizer';
```

`code`: `'EXECUTION_ERROR'`

---

## Class: `NotFoundError`

Thrown when a referenced node or flow is not found during execution.

```ts
import { NotFoundError } from '@noocodex/dagonizer';
```

`code`: `'NOT_FOUND_ERROR'`

---

## Class: `ValidationError`

Thrown when schema validation fails — e.g. `DAGSchema` or `CheckpointDataSchema`.

```ts
import { ValidationError } from '@noocodex/dagonizer';
```

`code`: `'VALIDATION_ERROR'`

The `message` contains every Ajv failure formatted as `<instancePath>: <message>`, one per line.

```ts
try {
  Dagonizer.load('{ "name": "broken" }');
} catch (error) {
  if (error instanceof ValidationError) {
    for (const line of error.message.split('\n')) {
      console.error(line);
    }
  }
}
```

---

## Class: `NodeTimeoutError`

Thrown when a node's per-node `timeoutMs` budget expires.

```ts
import { NodeTimeoutError } from '@noocodex/dagonizer';
```

`code`: `'NODE_TIMEOUT'`

### Additional properties

| Property | Type | Description |
|----------|------|-------------|
| `nodeName` | `string` | Name of the node that timed out |
| `timeoutMs` | `number` | The budget that elapsed (ms) |

### Constructor

```ts
new NodeTimeoutError(nodeName: string, timeoutMs: number, options?: ErrorOptions)
```

---

## Interface: `DAGErrorInterface`

Structural shape of `DAGError` for callers that need to accept it without a class reference:

```ts
interface DAGErrorInterface extends Error {
  readonly code: string;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
}
```

---

## Interface: `DAGErrorJSON`

Shape returned by `DAGError.toJSON()`:

```ts
interface DAGErrorJSON {
  name: string;
  message: string;
  code: string;
  timestamp: string;       // ISO 8601
  stack?: string;
  context?: Record<string, unknown>;
  cause?: { name: string; message: string; stack?: string } | unknown;
}
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
