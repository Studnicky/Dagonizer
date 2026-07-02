---
'@studnicky/dagonizer': minor
---

`BaseAdapter.chat()` gains opt-in circuit breaking and rate limiting via the new `circuitBreaker`/`tokenBucket` fields on `BaseAdapterOptionsType`, backed directly by `@studnicky/resilience`'s `CircuitBreaker` and `TokenBucket` — no Dagonizer wrapper. Both default to `null` (disabled); existing adapter construction is unaffected. When configured, the circuit breaker wraps outside the retry loop (outermost) and the token bucket wraps immediately inside it, so an open circuit or an exhausted bucket fails a `chat()` call once, instantly, without spending retry attempts or a rate-limit token on a call that was never going to run. `CircuitBreaker`, `CircuitBreakerOpenError`, `TokenBucket`, and `TokenBucketExhaustedError` are re-exported from `@studnicky/dagonizer/adapter`.

`package.json` gains `@studnicky/resilience` as a dependency.
