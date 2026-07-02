---
'@studnicky/dagonizer': major
---

`DAGError` now extends `@studnicky/errors`'s `ModuleError` instead of `Error` directly, gaining cause-chain traversal (`findCauseOfType`, `getCauseChain`, `hasCauseOfType`) and a `retryable: boolean` classification. Dagonizer's error taxonomy collapses to this ONE class: `ConfigurationError`, `ExecutionError`, `NotFoundError`, `ValidationError`, and `NodeTimeoutError` are removed. Every site that threw one of those now throws `DAGError` with the same `code` string the subclass used to fix (`CONFIGURATION_ERROR`, `EXECUTION_ERROR`, `NOT_FOUND_ERROR`, `VALIDATION_ERROR`, `NODE_TIMEOUT`) — callers distinguish by `error.code`, not `instanceof` on a subclass. `NodeTimeoutError`'s `nodeName`/`timeoutMs` fields fold into `context: { nodeName, timeoutMs }`; a `NODE_TIMEOUT` error also carries `retryable: true`. `ExecutionError.ofSignal(signal)` moves to `DAGError.ofSignal(signal)`, unchanged otherwise. `DagContainerError` is removed the same way — `DagContainerBase` throws `DAGError` with code `DAG_CONTAINER_ERROR`. `DAGError`'s constructor signature is `(message, { code?, context?, cause?, retryable?, statusCode? })` — `code` defaults to `'DAG_ERROR'`, `context` defaults to `{}`. `DAGErrorInterface` and the `DAGErrorJSON` wire schema are removed — `DAGError.toJSON()` is `ModuleError`'s own serialization; nothing reconstructed a `DAGError` from its old bespoke JSON shape.

`RetryPolicy`'s `retryOn`/`abortOn` filters accept a new `ErrorMatcherType` (`ErrorConstructorType | string`): an error constructor (matched via `instanceof`, for a consumer's own error classes) or a `DAGError` code string, since Dagonizer's own errors are no longer distinguishable by constructor identity.

`package.json` gains `@studnicky/errors` as a dependency.
