---
"@noocodex/dagonizer": minor
---

Codebase-wide audit and hardening pass: collapse dual representations, remove callback extension seams, enforce schema-as-source-of-truth at every JSON ingest boundary, and align the sibling packages to one opinionated shape.

Breaking changes (pre-1.0; see CHANGELOG `[Unreleased]` for full migration notes): `NodeInterface.contract` and `NodeInterface.timeout` are now required (`EMPTY_CONTRACT_FRAGMENT` / `Timeout.none()` defaults; `MonadicNode` unaffected); `RetryPolicy` is constructed via `RetryPolicy.from()`; `BaseStore.update` is abstract; `HttpTransport.validate` callback removed; `ChatMessage` is a role-discriminated union; DAG-document (de)serialization moved to `DAGDocument` (the static `Dagonizer.load/serialize` delegates are removed); `TypedStore` lifecycle access moved to `.inner`; `GatherStrategies`/`OutcomeReducers` registries throw on duplicate (`replace()` for intentional overrides); adapter wire-shape entities relocated to `entities/adapter/` (breaking the `contracts → adapter` cycle); adapter option-type aliases removed; the `Book` entity is composed into `BookIdentity`/`BookPublication`/`BookAvailability` with a `BookBuilder.from()` factory.

Additions: public `EMPTY_CONTRACT_FRAGMENT`, `IncrementalGatherStrategy`, `DAGDocument`, `ScatterWorkerPool`, `StoreSnapshotSchema`, shared `SystemInfo.recommendedWorkerCount`, `'ABORTED'` `ToolErrorReason`, uniform adapter `maxAttempts`, `OpenRouter` `referer`/`title` options, Ollama-Cloud API-key support, and `ForkEntry`/`SpawnEntry`/`WorkerEntry` static node entries.
