---
seeAlso:
  - text: 'Reference: Validation'
    link: './validation'
---

# Errors

`@studnicky/dagonizer/errors`

All errors thrown by the dispatcher are `DAGError` instances. `DAGError` is a single class distinguished by its `code` string — not a class hierarchy. Every throw site constructs `DAGError` with a `code` (`CONFIGURATION_ERROR`, `EXECUTION_ERROR`, `NOT_FOUND_ERROR`, `VALIDATION_ERROR`, `NODE_TIMEOUT`, or the container-specific `DAG_CONTAINER_ERROR`); callers distinguish by `error.code`, not `instanceof` on a subclass. Structured per-error data (e.g. a timed-out node's name and budget) lives in `context`.

`DAGError` extends `@studnicky/errors`'s `ModuleError`, gaining cause-chain traversal (`findCauseOfType`, `getCauseChain`, `hasCauseOfType`) and a `retryable` classification.

---

## Class: `DAGError`

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
  retryable: false,
  statusCode: 500,
});
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | `'DAGError'` |
| `code` | `string` | Error classification code |
| `timestamp` | `number` | Unix millisecond timestamp at construction |
| `context` | `Record<string, unknown>` | Structured context payload (always present, defaults to `{}`) |
| `cause` | `Error \| undefined` | Chained cause |
| `retryable` | `boolean` | Whether the condition may succeed on retry |
| `statusCode` | `number \| undefined` | HTTP status code, when applicable |

### `toJSON()`

```ts twoslash
import { DAGError } from '@studnicky/dagonizer';
// ---cut---
const error = new DAGError('something failed', { code: 'EXECUTION_ERROR', context: { flowName: 'my-flow' } });
console.log(JSON.stringify(error.toJSON(), null, 2));
```

Inherited from `ModuleError`. Returns a JSON-safe representation: `code`, `message`, `name`, `retryable`, `stack`, `context` (when present), `statusCode` (when present), and `cause` (recursively serialized when the cause is itself a `ModuleError`, or `{ message, name, stack }` for a plain `Error`).

`toSerializedError()` (inherited from `BaseError`) returns the same shape typed as `SerializedErrorType`, walking the full cause chain to `CAUSE_CHAIN_DEPTH_LIMIT`.

---

## Error codes

| Code | Thrown when |
|------|-------------|
| `CONFIGURATION_ERROR` | Flow or node configuration is invalid (registration time). Typically thrown by `registerNode` when `validate()` returns `{ valid: false }`. |
| `EXECUTION_ERROR` | The dispatcher encounters an unrecoverable runtime condition during flow execution. |
| `NOT_FOUND_ERROR` | A referenced node or flow is not found during execution. |
| `VALIDATION_ERROR` | Schema validation fails (e.g. `DAGSchema` or `CheckpointDataSchema`). The `message` contains every Ajv failure formatted as `<instancePath>: <message>`, one per line. |
| `NODE_TIMEOUT` | A node's per-node `timeoutMs` budget expires. `context` carries `nodeName` and `timeoutMs`. |
| `DAG_CONTAINER_ERROR` | A container operation fails for infrastructure reasons (pool destroyed, semaphore timeout, abort). See [Reference: Container](./container). |

```ts twoslash
import { DAGError } from '@studnicky/dagonizer';
// ---cut---
// Configuration error at registration time.
new DAGError('invalid node config', { code: 'CONFIGURATION_ERROR', context: { nodeName: 'fetch-user' } });

// Node timeout, with the budget and node name in context.
new DAGError('node timed out', {
  code: 'NODE_TIMEOUT',
  context: { nodeName: 'my-node', timeoutMs: 5000 },
  cause: new Error('root'),
});
```

```ts
<<< @/../examples/03-schema.ts#validate
```

Callers distinguish error kind by inspecting `error.code`:

```ts twoslash
import { DAGError } from '@studnicky/dagonizer';
declare const error: DAGError;
// ---cut---
if (error instanceof DAGError && error.code === 'VALIDATION_ERROR') {
  // handle validation failure
}
```

## Related guides

- [Schema & JSON loading](../guide/schema)
- [Subclassing State](../guide/subclassing)
