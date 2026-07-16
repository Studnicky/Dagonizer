---
"@studnicky/dagonizer": minor
"@studnicky/dagonizer-executor-web": minor
---

`WorkerObserver` dedups identical instrumentation events (`nodeStart`, `nodeEnd`, `phaseEnter`, `phaseExit`, `error`) within each microtask flush window before sending the `instrumentationBatch` BridgeMessage. Inner scatter-clone nodes report a static `placementPath`, so a scatter over millions of items previously relayed one indistinguishable event per clone per node to the parent's consumer hooks — O(events × nodes) main-thread work that froze the browser. Dedup is on by default and lossless: events differing in `output` (e.g. one clone routing `nodeEnd`→`success`, another →`error`) are never merged. Opt out via `coalesceInstrumentation: false` on `WebWorkerContainer` (and any `DagContainerBase` consumer) to receive every raw event.
