---
'@studnicky/dagonizer': minor
---

`RetryPolicy.shouldRetry(error, attempt)` now consults `DAGError.retryable` instead of ignoring it. Precedence: an explicit `abortOn` match always stops retrying; an explicit `retryOn` list, when configured, is still the sole authority (a miss stops retrying); when NO `retryOn` filter is configured, a `DAGError` now falls back to its own `error.retryable` field instead of the old unconditional "no filter = retry everything" default. A non-`DAGError` error with no filters configured is unaffected and still retries.

**Behavior change:** a `DAGError` constructed with `retryable: false` (the schema default) and retried under a `RetryPolicy`/placement `retry` config that sets no `retryOn`/`abortOn` filters previously WAS retried by default; it is now NOT retried — the error's own "don't retry me" classification is honored. A `DAGError` with `retryable: true` and no filters keeps retrying, as before. Consumers relying on the old "retry every `DAGError` by default" behavior for a `DAGError` they explicitly marked `retryable: false` should either drop `retryable: false` or add an explicit `retryOn`/`abortOn` matcher.

`RetryPolicy`'s class doc gains a documented (non-enforced) guidance example for wrapping `BaseAdapter.chat()` in an OUTER `RetryPolicy`: configure `abortOn: [CircuitBreakerOpenError, TokenBucketExhaustedError]` (both re-exported from `@studnicky/dagonizer/adapter`) so the outer policy fails fast on an already-open circuit or exhausted bucket instead of hammering it with further attempts. `BaseAdapter`'s own internal retry loop is unaffected — this is guidance for a consumer's own external retry wrapper, not a new default.
