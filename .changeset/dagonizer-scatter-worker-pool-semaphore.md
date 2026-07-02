---
'@studnicky/dagonizer': major
---

`ScatterWorkerPool` now bounds scatter-node concurrency with `@studnicky/concurrency`'s `Semaphore` instead of a hand-rolled slot counter. The pool builds one `Semaphore` (`Semaphore.builder().withPermits(concurrencyLimit).build()`) in its constructor and drives the pull loop by `acquire()`ing a permit before each pull and calling the returned release function once an item's execute+ack cycle settles; the internal `#activeWorkers` counter and `#slotResolve`/`#waitForSlot`/`#releaseSlot` methods are removed. The pull loop re-checks accumulated worker errors and the abort signal immediately after each `acquire()` resolves — not only at loop entry — so a worker error recorded while an iteration was queued for a permit is observed before another item is pulled. `ScatterWorkerPool`'s public constructor and `drain()`/`errors` surface are unchanged.

`package.json` gains `@studnicky/concurrency` as a dependency.
