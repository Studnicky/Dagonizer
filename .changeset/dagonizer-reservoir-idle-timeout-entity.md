---
'@studnicky/dagonizer': patch
---

`ReservoirBuffer` narrows its `reservoir.idleMs` construction option to the reified `Timeout` entity once, at construction, instead of carrying the raw `number | undefined` through every idle-timer code path (`#armIdleTimer`, the `#idleAbort` gate). `ReservoirBufferOptionsType`'s public shape (`reservoir: { keyField, capacity, idleMs? }`) and `ReservoirBuffer`'s constructor/`drain()` surface are unchanged — this is an internal representation change only, aligning the idle-release "give up and release the batch" concept with the same `Timeout`/`Timeout.none()` semantic `MonadicNode.timeout` and `DagTaskInterface.timeout` already use for per-operation time budgets.
