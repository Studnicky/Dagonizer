---
'@studnicky/dagonizer': major
---

`ReservoirBuffer` (the reservoir-mode scatter execution path) now bounds concurrent batch dispatch with the same real `@studnicky/concurrency` `Semaphore` `ScatterWorkerPool` uses, instead of its own hand-rolled `#activeWorkers` counter and `#slotResolve`/`#waitForSlot`/`#releaseSlot` promise. Every batch dispatch — pull-loop capacity release, idle-timer release, complete-flush release, and resume replay (`replayBuffers`) — now acquires a `Semaphore` permit before executing and releases it once the batch settles, so `concurrencyLimit` is a hard cap on concurrently in-flight batches everywhere, including resume replay and idle-timer releases (previously those two paths could burst past the limit). `ReservoirBuffer`'s public constructor and `drain()` surface are unchanged.
