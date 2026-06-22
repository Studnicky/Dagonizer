---
"@studnicky/dagonizer": minor
---

Services constructor-DI, typed metadata reads, store typed reads, and a repo-wide
`noun.verb()` / cast-free conformance sweep.

- **Breaking: services are injected into nodes, not threaded through the dispatcher.**
  The `TServices` generic, the `context.services` field, the `Dagonizer` `services`
  constructor option, and `AgentServicesType` are removed. A node that needs an
  external dependency (an LLM adapter, a store, a tool, a triple-store) receives it
  through its own constructor and holds it as an instance field, and is registered
  with that dependency (`dispatcher.registerNode(new FetchNode(db))`). `Dagonizer`
  is now `Dagonizer<TState>` (one type parameter); `NodeInterface<TState, TOutput>`,
  `ScalarNode`, `MonadicNode`, and `NodeContextType` are non-generic over services;
  `NodeContextType` carries only `signal`, `dagName`, `nodeName`, `validateOutputs`,
  and `outputSchemaValidator`. The pattern packages follow suit: `GraphNode(memory)`,
  `LlmDispatchNode(llm)`, `ScoutNode(tool)`, `CallModelNode(llm)`. **Migration:** drop
  the `<TServices>` type argument and the `{ services }` option; give each node a
  constructor accepting the dependencies it read from `context.services`, store them
  as fields, and pass them when constructing the node for registration.

- **Breaking: `TState` generic removed from engine internals.** The engine threads
  state through `NodeStateInterface` uniformly across all internal modules.
  `DagTaskInterface` and `DagContainerInterface` are non-generic; `GatherExecutionType<TItem>`
  carries `state` as `NodeStateInterface`. The public boundary (`Dagonizer<TState>`,
  `execute`, `resume`, `Execution<TState>`, `NodeResultType<TState>`,
  `ExecutionResultType<TState>`) keeps `TState`. Embedded/scatter child DAGs run on
  their own heterogeneous state classes — each implements `NodeStateInterface` but is
  not `TState`. **Migration:** consumers passing a concrete `TState` generic to
  `DagContainerInterface` or `DagTaskInterface` remove that type argument; all other
  public-API call sites are source-compatible.

- **Typed metadata reads via `state.getter` (`MetadataGetter`).** `NodeStateBase.getMetadata(key)`
  returns `unknown` (the metadata store holds arbitrary JSON), so every state exposes
  `state.getter` — a `MetadataGetter` with `string(key, fallback?)`, `number`,
  `boolean`, `stringArray`, and `numberArray` that narrow each read to a concrete type
  with a required default, cast-free. `MetadataGetter` ships on the root barrel;
  `MetadataReadableInterface` (its minimal read contract) ships on `./contracts`.

- **Store typed reads = configured validation.** `StoreInterface.get`/`update` return
  `JsonValueType` (no `<T>` generic); `BaseStore.narrowStored` is removed. `TypedStore`
  takes a per-key validator record and validates on read (the validator is the
  type-guard), toggled like `validateOutputs`.

- **Cast-free / `noun.verb()` conformance sweep.** `StateAccessorInterface.get` returns
  `unknown` and callers narrow; `EventBus.publish`/`subscribe` operate on an `unknown`
  payload; remaining `as` casts are removed in favour of `noun.is` type-guards,
  `filter*` builders, and membership checks. Every freestanding/nested `verbNoun`
  helper is hoisted to a `noun.verb()` method (`PlacementRank.rankFor`,
  `MermaidExplorer.#dismiss`). **Migration:** replace `accessor.get<T>(state, path)`
  with `accessor.get(state, path)` plus a narrowing check; replace
  `bus.subscribe<T>(topic, fn)` with `bus.subscribe(topic, fn)` and narrow
  `event.payload`.
