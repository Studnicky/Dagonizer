import type { ErrorConstructorType } from './ErrorConstructorType.js';

/**
 * Matcher for `RetryPolicy`'s `retryOn`/`abortOn` filters. Either an error
 * constructor, matched via `instanceof` — for arbitrary custom error
 * classes a consumer defines (e.g. its own `NetworkError`) — or a `DAGError`
 * code string (e.g. `'NODE_TIMEOUT'`), matched via `error instanceof
 * DAGError && error.code === matcher`. Dagonizer's own error taxonomy is
 * one class (`DAGError`) distinguished by `.code`, so a code string is the
 * only way to filter on it without reintroducing per-code subclasses.
 */
export type ErrorMatcherType = ErrorConstructorType | string;
