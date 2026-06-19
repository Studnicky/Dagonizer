---
"@studnicky/dagonizer": minor
---

Tech-debt remediation — a coherent breaking release across the whole monorepo (all
packages version in lockstep).

**Observability boundary.** The framework emits nothing and routes no diagnostic.
The warning machinery is removed (`WarningEmitter`, `NoopWarningEmitter`,
`onContractWarning`) from `./contracts`/`./runtime`/`./types`/`./builder`; contract
misalignment now throws `DAGError` — dead writes are fatal like dangling reads, and
an unbound container role on a non-empty registry throws.

**Schemas as source of truth.** Every satellite wire and host shape is a `*Schema` +
`FromSchema` type narrowed through `Validator.compile` against the framework's single
shared Ajv; no consumer builds its own Ajv. `|undefined` fields become null
sentinels.

**Onion-skin layering.** `ObserverRelay`/`DispatcherBundle` → `./contracts`;
`DAGDocument` moves to the new `./dag` subpath; `./core` no longer re-exports
`GatherExecution`/`GatherRecord`/`OutcomeRecord` (import from `./contracts`).

**Naming convention (types-are-data / interfaces-are-contracts).** Enforced by ported
`@noocodec` ESLint rules: every `type` ends in `Type`, every `interface` is a contract
ending in `Interface`, method-less data shapes are `type`s, runtime names are bare (no
`Impl`/`Fn`). Consequently every public entity type gains a `Type` suffix
(`NodeContextType`, `NodeOutputType`, `ExecutionResultType`, …) and every adapter
contract gains an `Interface` suffix (`StoreInterface`, `EmbedderInterface`,
`LlmAdapterInterface`, `ClockProviderInterface`, …). Six type+value collisions are
resolved by pluralizing the constant values (`NodeTypes`, `MetadataKeys`, …). Numerous
`make/build/from/parse/create` identifiers become idiomatic `noun.verb()`
(`DAGBuilder.derive`, `ScatterOptions.resolve`, `NodeContextBuilder.of`,
`LlmError.ofNetworkError`, `RegistryModule.instantiate`, …).

**Pattern coherence & duplication.** Class-extension over function seams
(`Cytoscape.create`, driver contracts in `./contracts`, `ToolError extends DAGError`);
shared bases push down duplication (`BaseMessageChannel`, `NodeContainerBase`,
`BaseAdapterCore.classify`, schema-property single-sourcing).

**Engine decomposition.** `Dagonizer.ts` (2968→885 lines) is now a composition root;
execution lives in focused `execution/` domain modules behind narrow ports
(`BodyExecutor`, `PlacementRouter`, `LeafExecutor`, `EmbeddedDagExecutor`,
`ScatterExecutor`, `Gather`, `NodeScheduler`, `PlacementDispatch`, `DagRegistrar`,
`EngineComposer`).

Examples are the leveled-logging reference (subclass + lifecycle hooks); the
cartographer collects errors as data through the DAG flow; the Ollama adapter
discovers an installed chat model instead of hardcoding. Behavior is preserved
throughout — the DAG-container conformance Laws 1–9 and the full test suite pass
unchanged.

BREAKING CHANGE: every public entity type is `Type`-suffixed and every adapter
contract is `Interface`-suffixed; the warning machinery is removed; `DAGDocument`
moves to `./dag`; numerous identifiers are renamed to `noun.verb()`.
