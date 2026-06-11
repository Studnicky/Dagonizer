# Dagonizer: Project Standards

`@noocodex/dagonizer` is a DAG dispatcher. Type-safe nodes, abortable
execution, deterministic resume. Backbone of the noocodex orchestration
stack; consumers extend and compose, never patch.

## Operating principles

⦿ **Class extension is the only extension mechanism.** Zero callbacks.
  Zero function-pass-in. Subclass the class or implement the adapter
  contract.
⦿ **Domain modules with `noun.verb()` only.** Static classes. No
  freestanding helpers (`makeX`, `buildX`, `fromX`, `parseX`). The
  registered name is the contract; the static method is the API.
⦿ **Schemas are the source of truth.** Every wire-shape entity has a
  `*Schema` value (JSON Schema 2020-12) and a `FromSchema`-derived
  TypeScript type. No hand-written wire shapes.
⦿ **Ajv compiled once at module load.** Validators are values, not
  factories. Consumers call `Validator.dag.validate(x)`; they never
  build their own Ajv against the package's schemas.
⦿ **No `unknown` outside the JSON ingest boundary.** Tight types
  inside the engine; `unknown` enters once at `Dagonizer.load(json)`
  and is narrowed to the schema-derived type immediately.
⦿ **Submodule exports are part of the public API.** Every public
  type, interface, schema, and class ships through a documented
  subpath import.
⦿ **Required-with-defaults over optional/undefined.** Optional fields
  (`T | undefined`, `field?:`, `arg?:`) are a tax: every consumer pays
  it forever in null-checks, every type narrowing has to handle the
  absent case, and the absent case is usually just a default the
  producer forgot to fill in. Prefer one of:
    1. Required field + module-level default constant. The producer
       fills the default; the consumer never sees absence.
    2. Static `noun.from(partial)` factory that materialises a complete
       value from a partial input. Defaults live in one place.
    3. Discriminated union when "absent" really means "different shape"
       (e.g. text response vs tool-call response).
  Optional is acceptable only at genuine system boundaries (JSON input
  the dispatcher hasn't narrowed yet, explicit `null` for "no value
  exists" sentinels). Inside the engine, `T` not `T | undefined`.
  This dovetails with `exactOptionalPropertyTypes: true` in the base
  tsconfig; both rules push toward "if the property is declared, it's
  there with a real value."
⦿ **V8 shape stability.** Object shape (key set, key order, property
  types) is part of the contract. Initialise every property in the
  constructor in declaration order; never add or delete properties
  after construction; never assign a value of a different type to a
  property. Optional/undefined breaks shape consistency: every
  instance with the property has one hidden class, every instance
  without has another, and V8 falls back to dictionary mode. The
  required-with-defaults rule above is the primary lever; classes for
  hot-path entities, consistent constructor order, and avoiding `as
  any` casts close the rest of the gap.
⦿ **Canonical names only: no aliasing imports or exports.** Every
  symbol has one canonical name, used everywhere. Forbidden:
    ⊥ `import { Foo as Bar }`
    ⊥ `export { Foo as Bar }`
    ⊥ `export type { Tool as SearchTool }` re-aliases
  When the type and the value would collide on one identifier (a
  pattern that surfaces with `*Builder` static factories), rename the
  value to its real role: type is `ChatResponseMessage`, factory is
  `ChatResponseMessageBuilder` (a static class). Two distinct names,
  no alias at any import site. Readers see exactly what was authored.
⦿ **Function signatures: required positional, optional config object.**
  Required arguments are positional in their natural order. Optional
  arguments, overrides, and ergonomic flags live in a single trailing
  config object (`options: { … } = {}`). One canonical shape for every
  method or factory in the codebase:
    `.method(requiredA, requiredB, options?)`, never
    `.method({ requiredA, requiredB, optional })` (when args are
    required) and never `.method(a, b, c, d)` with optional positional
    tail. The trailing config object's own fields follow the same
    required-with-defaults rule as the rest of the engine.

## Three-tier interface taxonomy

Three distinct kinds of interface live in `src/`. Each lives in a
specific place. Pre-existing files that drift toward a fourth pattern
are migrated to one of the three.

### 1. Class-shape interfaces

Describe the public face of one class. Always live in the **same file**
as the class. Exported as `type` only (the class is the value, the
interface is the type the class implements).

| Interface | Class | File |
|-----------|-------|------|
| `DagonizerInterface` | `Dagonizer` | `src/Dagonizer.ts` |
| `NodeStateInterface` | `NodeStateBase` | `src/NodeStateBase.ts` |
| `DAGErrorInterface`  | `DAGError`     | `src/errors/DAGError.ts` |

Adding a new class with a public face? Define the interface in the
same file, above the class. Do not create a sibling `*Interface.ts`.

### 2. Adapter contracts

What consumers implement to swap a backend or contribute behavior.
Live at the root of `src/contracts/`, **single source of truth**, never
re-exported from sibling modules.

Examples: `ClockProvider`, `SchedulerProvider`, `NodeInterface`,
`ExecuteOptionsInterface`, `RetryPolicyOptionsInterface`,
`ErrorConstructorType`.

A `runtime/` barrel may re-export an adapter contract for ergonomic
co-import with the engine class; the source of the type stays in
`contracts/`.

Adding a new contract? Create `src/contracts/<Name>.ts`. Do not embed
it in the consumer module.

### 3. Entity-narrowing interfaces

Pair with a JSON Schema-derived entity. Narrow the wire shape with
runtime-only fields (e.g. `signal: AbortSignal`) or with a generic
parameter that the schema cannot express. Live in the same file as
the entity at `src/entities/<group>/<Entity>.ts`.

| Interface | Entity | File |
|-----------|--------|------|
| `NodeContextInterface` | `NodeContext` | `src/entities/node/NodeContext.ts` |
| `NodeOutputInterface<TOutput>` | `NodeOutput` | `src/entities/node/NodeOutput.ts` |
| `NodeResultInterface<TState>` | `NodeResult` | `src/entities/node/NodeResult.ts` |
| `NodeErrorInterface` | `NodeError` | `src/entities/node/NodeError.ts` |
| `ExecutionResultInterface<TState>` | `ExecutionResult` | `src/entities/execution/ExecutionResult.ts` |
| `SingleNodePlacementInterface<TOutput>` | `SingleNode` | `src/entities/dag/SingleNode.ts` |

Adding a new entity that consumers narrow at compile time? Add the
schema, the `FromSchema` type, and the narrowing interface in the
same file. Re-export all three from `entities/index.ts`.

## Submodule exports

Every public surface ships through a `package.json` `exports` entry:

| Subpath | Contents |
|---------|----------|
| `.` | Root barrel: classes, constants, errors, schemas, types |
| `./types` | Every public type and interface (no runtime classes) |
| `./contracts` | Every adapter contract |
| `./entities` | Every JSON Schema and derived type |
| `./errors` | `DAGError` and subclasses, `DAGErrorInterface` |
| `./constants` | Constant value+type pairs (`GatherStrategyName`, `MetadataKey`, `NodeType`, `Output`, `ScatterOutput`) |
| `./lifecycle` | `DAGLifecycleMachine`, lifecycle types |
| `./runtime` | `Clock`, `Scheduler`, `RetryPolicy`, `RealTimeScheduler`, `BackoffStrategy` |
| `./builder` | `DAGBuilder` and its option interfaces |
| `./validation` | `Validator` and `EntityValidator<T>` |
| `./checkpoint` | `Checkpoint`, cursor serialization |
| `./testing` | `VirtualClockProvider`, `VirtualScheduler` (test-only) |
| `./adapter` | LLM adapter contract surface: `BaseAdapter`, `OpenAiCompatibleAdapter`, `LlmAdapterRegistry`, chat/tool schemas + `FromSchema` types, capability descriptors |
| `./patterns` | Pattern-tier base classes consumers extend (`MonadicNode` and pattern node bases) |
| `./tool` | Tool contract surface: `Tool`, `HttpTransport`, `ToolError` |
| `./core` | Pluggable execution primitives: `GatherStrategies`, `GatherStrategy`, `OutcomeReducers` |
| `./derive` | Contract-derived flow generation: `DAGDeriver`, `OperationContract` |
| `./viz` | DAG visualization: `CytoscapeRenderer`, `MermaidRenderer` |
| `./store` | Shared key-value store: `Store`, `BaseStore` |
| `./container` | Embedded-DAG container surface: `DagContainerBase`, channel dispatch, transport contracts |
| `./channels` | `InMemoryChannel` and its options |

Adding a new top-level concept? Add a subpath. Do not silently expand
the root barrel.

## Composition rules

⦿ Consumers extend `Dagonizer` for observability hooks (`onFlowStart`,
  `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`). Multi-observer
  composition is the consumer's responsibility; write it into the
  subclass.
⦿ Consumers extend `NodeStateBase` for domain-specific state. Override
  `snapshotData()` and `restoreData()` for checkpointable fields.
⦿ Consumers implement `NodeInterface<TState, TOutput>` for nodes.
  Nodes never throw; they route to a named output.
⦿ Consumers implement `SchedulerProvider` / `ClockProvider` to swap
  time sources (typically only in tests; `RealTimeScheduler` is the
  production default).

## Verification

Every commit lands with:

⦿ `npm run typecheck` clean.
⦿ `npm run lint --max-warnings 0` clean.
⦿ `npm run test` clean; every existing test passes.
⦿ New public surface ships with new tests.
⦿ CHANGELOG entry under the next `## [unreleased]` section in
  present-tense factual form.
