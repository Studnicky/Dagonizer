---
"@studnicky/dagonizer": minor
---

Adds an isomorphic browser substrate: three new store packages (`dagonizer-store-indexeddb`, `dagonizer-store-opfs`, `dagonizer-store-webstorage`) provide durable, DOM-lib-free browser persistence via IndexedDB, Origin Private File System, and Web Storage respectively. Each ships a `BaseStore` subclass and a paired `CheckpointStoreInterface` implementation; access to browser globals uses `Reflect.get(globalThis, …)` + structural type-guard predicates — no `as` casts, no DOM lib dependency.

The store port gains a streaming snapshot/restore seam (`snapshotStream` / `restoreStream`) as `AsyncIterable` paths on `SnapshottableInterface`; `BaseStore` provides concrete implementations built on new abstract hooks `performEntriesStream`, `performRestoreEntry`, and `performClear`. All existing store subclasses are migrated.

The streaming-producer→scatter path is unified into a single engine dispatch: producers feed `ScatterNode` through one code path regardless of sync or async source. `StreamChannel.resumable` and `StreamCursor.resumeAfter` (cursor = pull count) cover caller-driven resume of async streams.

`BaseAdapterOptionsType` gains a `systemPrompt` field: a consumer-supplied default the base injects as the leading message of any chat request that carries no system message. Leading position is load-bearing for on-device backends (Chrome Prompt API, MLC WebLLM). `OpenAiCompatibleAdapter` and its static preset factories (`groq`, `cerebras`, `mistral`, `openRouter`) accept and forward the same option.

Every LLM adapter now uniformly exposes both `systemPrompt` and a per-request `timeoutMs` (default 60s). The HTTP adapters (`anthropic`, `gemini-api`, `ollama`, and the OpenAI-compatible presets) enforce the deadline around the network request; the on-device adapters enforce it around generation — `gemini-nano` composes the timeout into the `LanguageModel.create()`/`session.prompt()` abort signal, and `web-llm` races the non-cancellable MLC generation against the deadline. An expired deadline surfaces as a `TIMEOUT` classification so a cascade falls through instead of hanging.

Per-placement retry is wired: `SingleNodePlacementType.retry` (a `RetryPolicyOptionsType`) wraps each `node.execute()` call in `RetryPolicy.from(placement.retry).run(…)` with the node abort signal threaded through. `DAGBuilder.node()` accepts a trailing options object with `retry`.

`executor-node` and `executor-web` add `"node"` and `"browser"` export conditions respectively for bundler target selection. `dagonizer-book-entities` entity types carry a mandatory `Type` suffix (`BookType`, `MoneyType`, …), and `CanonicalId` is a sealed static class whose canonical materializer is `CanonicalId.ofIsbns`. `dagonizer-patterns-flow` `FlowNode` is parameterized by `<TState, TOutput>`, with services injected through the node constructor.

A CI guard script (`scripts/check-fixed-group.ts`) enforces that the changeset fixed group matches the full set of publishable workspace packages.
