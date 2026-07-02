---
'@studnicky/dagonizer': minor
---

`ScatterNode` gains an opt-in `throttle: { concurrencyLimit }` option (`null` when absent — the default, unchanged behavior) backed by `@studnicky/throttle`'s `Throttle`. On the non-reservoir scatter path, `ScatterWorkerPool` wraps `driver.executeItem` dispatch through an owned `Throttle` instance when `throttle` is set, as a second concurrency window independent of the existing `concurrency` `Semaphore` gate — the semaphore still caps how far the pull loop runs ahead of dispatch capacity; the throttle, when present, additionally paces the actual item-execution calls. `Throttle`'s own "sliding window" is a concurrency window (like `Semaphore`), not a wall-clock rate window — there is no `operationsPerWindow`/`windowMs` field on the underlying `@studnicky/throttle` package, so `throttle` is intentionally scoped to `concurrencyLimit`. The reservoir scatter path does not wire `throttle`: batch dispatch size varies with capacity/idle/flush triggers, so a per-batch throttle would gate a variable-size unit rather than the discrete per-item work `throttle` targets on the non-reservoir path; only `concurrency` (the `Semaphore`) gates batch dispatch there.

`ScatterNodeDefaults.throttle(node)` resolves the option, defaulting to `null`. `ScatterThrottleOptionsType` is exported from `@studnicky/dagonizer/entities`.

`package.json` gains `@studnicky/throttle` as a dependency.
