---
'@studnicky/dagonizer': major
---

`SignalComposer` is removed; the engine now depends on `@studnicky/signal`'s `Signal` class for `AbortSignal` composition. `Signal.compose(options)` never returns `null` — it falls through to `Signal.never()` (a cached, never-aborting `AbortSignal`) when neither `signal` nor `deadlineMs` is supplied, and validates `deadlineMs` (throws `SignalError` on negative/`NaN`).

Every public method that previously accepted or returned `AbortSignal | null` because of `SignalComposer.compose`'s old nullable contract now works with a plain `AbortSignal`: `Dagonizer.bodyContext`, `Dagonizer.nodeContext`, `Dagonizer.withNodeTimeout`, `Dagonizer.executeDAGNode`, and the corresponding fields on `NodeSchedulerSourceInterface`, `LeafExecutorSourceInterface`, `GatherSourceInterface`, `ScatterDispatchSourceInterface`/`ScatterDispatchAdapterInterface`, `BodyRunPortInterface`, `NodeInvokerSourceInterface`, and `GatherExecutionType.signal`. A run with no caller-supplied cancellation surface carries `Signal.never()` end-to-end instead of `null`; consumers implementing these ports no longer need a null-check before forwarding a signal.

`@studnicky/dagonizer/runtime` no longer exports `SignalComposer`. Consumers that imported it directly should import `Signal` from `@studnicky/signal` instead: `Signal.compose(options)` and `Signal.never()` are drop-in replacements for `SignalComposer.compose` (adjusted for the never-null contract) and `SignalComposer.never()`.
