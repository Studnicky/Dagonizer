# Scatter-Gather Unification

`@noocodex/dagonizer` exposes one operation — *isolate a state clone, run a body
in it, merge the clone back into the parent, route on the outcome* — as two node
types: `EmbeddedDAGNode` (one clone, DAG body) and `FanOutNode` (N clones, single-
node body). They duplicate the dispatch skeleton and the merge concept. This is a
breaking unification into a single `ScatterNode` and a single dispatch path. No
shims, no back-compat, no migration tooling. Consumers update to the new contract;
the docs describe the new contract in present tense as the only contract.

`ParallelNode` is out of scope — it does not clone (children mutate shared parent
state concurrently). It remains its own type.

## The new contract

### `ScatterNode` (replaces `FanOutNode` + `EmbeddedDAGNode`)

```jsonc
{
  "@id":   "urn:noocodex:dag:<dag>/node/<name>",
  "@type": "ScatterNode",
  "name":  "<name>",
  "body":  { "node": "<registeredNode>" } | { "dag": "<registeredDag>" },
  "source":      "<state.arrayPath>",   // optional — absent ⇒ exactly one clone
  "itemKey":     "<metadataKey>",        // optional — current item binds here (source case)
  "concurrency": 4,                       // optional — source case; default = item count
  "projection":  { "<cloneFieldPath>": "<parentPath>" },  // optional — parent → clone, before body
  "gather":      { /* GatherConfig */ },  // optional — produced clone state → parent
  "reducer":     "aggregate" | "terminal" | "<custom>",   // optional — outcome → route
  "outputs":     { "<routeName>": "<nextNode>" | null }
}
```

Required: `@id`, `@type`, `name`, `body`, `outputs`. `body` is a discriminated
union: a single registered node, or a registered sub-DAG, run once per clone. A
single-node body is not wrapped — the dispatcher branches on `body.node` vs
`body.dag` at the one point the two cases legitimately differ.

Field dependencies (validated): `itemKey` and `concurrency` are meaningful only
with `source`. `projection` keys are clone paths, values are parent paths.

### `GatherConfig` (replaces `FanInConfig` + `stateMapping.output`)

```jsonc
{
  "strategy": "map" | "append" | "partition" | "custom",
  "mapping":    { "<cloneFieldPath>": "<parentPath>" },  // map
  "field":      "<cloneFieldPath>",                       // append/partition — omit ⇒ gather the source item
  "target":     "<parentArrayPath>",                      // append
  "partitions": { "<outputToken>": "<parentArrayPath>" }, // partition
  "customNode": "<registeredNode>"                        // custom
}
```

Every gather strategy receives the per-clone records `{ index, item, output,
state }` (the produced clone). Strategies:

- **`map`** — for each `cloneFieldPath → parentPath` in `mapping`, read the field
  off each clone in source-index order and write to the parent. One clone ⇒ scalar
  set (this is the old `stateMapping.output`). N clones ⇒ array append (this is the
  generate-collect capability — produced artifacts survive).
- **`partition`** — bucket records by their `output` token into `partitions[token]`.
  The value pushed is the clone's `field` path when set, else the source item
  (the old fan-out partition behaviour, generalized to produced data).
- **`append`** — flatten the clone's `field` (or the source item) across all
  records into `target`.
- **`custom`** — expose the records under `gatherResults` metadata and invoke
  `customNode` through the engine.

### Outcome reducers (replaces hardcoded fan-out aggregate + embedded terminal routing)

A registry mirroring `GatherStrategies` / `ParallelCombiners`. Resolved by
`reducer` name; default `aggregate` when `source` is present, `terminal` when
absent. Defaults:

- **`aggregate`** — `output === 'success'` counts as success → `all-success` |
  `partial` | `all-error` | `empty`.
- **`terminal`** — single clone; a DAG body's `failed` terminal outcome or any
  unrecoverable collected error routes `error`, else `success`; a node body routes
  `error` when its output is `error`, else `success`.

## Engine

One private `executeScatter` replaces `executeFanOut`, `executeEmbedded`, and
`mapOutputState`:

1. `items = source ? accessor.get(state, source) : [SINGLETON]`. Empty source ⇒
   reducer's empty route, skip.
2. Per batch (`concurrency`, singleton ⇒ one): `clone = createChildState(state,
   projection)`; on the source case `clone.setMetadata(itemKey ?? 'currentItem',
   item)` + `itemIndex`.
3. Run body: `body.node` → `node.execute(clone, ctx)`; `body.dag` →
   `runNodes(body.dag, clone, …)` capturing `terminalOutcome`.
4. Propagate `clone.errors` / `clone.warnings` to the parent.
5. Record `{ index, item, output, terminalOutcome, state: clone }`.
6. `GatherStrategies.resolve(gather.strategy).apply(records, parent)`.
7. `OutcomeReducers.resolve(reducer).reduce(records)` → route via `outputs`.

`createChildState` (already clone + projection) is reused. Resume bookkeeping
generalizes from `StoredFanOutProgress` to per-scatter-name records carrying the
per-index output (and, for `map`, the gathered value) so a resumed scatter
reconstructs `gather` deterministically. The singleton case needs no progress
record.

## Builder

A single `scatter()`; `fanOut()`, `embeddedDAG()`, `FanOutOptionsInterface`,
`EmbeddedDAGOptionsInterface`, and `TypedEmbeddedDAGOptionsInterface` are removed.

```ts
scatter<TState extends NodeStateInterface, TOutput extends string, TServices = undefined>(
  name: string,
  body: NodeInterface<TState, TOutput, TServices> | { readonly dag: string },
  outputs: Record<string, null | string>,
  options?: ScatterOptionsInterface<TState>,
): this
```

`ScatterOptionsInterface<TState>`: `{ source?, itemKey?, concurrency?, projection?,
gather?, reducer? }`. A `NodeInterface` body registers the impl and emits
`{ node: body.name }`; a `{ dag }` body emits `{ dag }`. `projection` keys and
`gather.mapping` paths narrow to `Path<TState>` (the typed-mapping narrowing
currently on `TypedEmbeddedDAGOptionsInterface` moves here).

## Deletions / renames

| Old | New |
|-----|-----|
| `entities/dag/FanOutNode.ts`, `EmbeddedDAGNode.ts` | `entities/dag/ScatterNode.ts` |
| `entities/dag/FanInConfig.ts` | `entities/dag/GatherConfig.ts` |
| `entities/constants/FanInStrategy.ts` | `entities/constants/GatherStrategy.ts` (add `map`) |
| `core/FanInStrategies.ts` (`FanInStrategy`, `FanInExecution`) | `core/GatherStrategies.ts` (`GatherStrategy`, `GatherExecution`, `map` added) |
| — | `core/OutcomeReducers.ts` (`OutcomeReducer`, registry) |
| `Dagonizer.executeFanOut` / `executeEmbedded` / `mapOutputState` | `Dagonizer.executeScatter` |
| `DAG.ts` two `oneOf` entries + `fanIn`/`stateMapping`/`dag` context terms | one `ScatterNode` entry + `body`/`source`/`itemKey`/`concurrency`/`projection`/`gather`/`reducer` context terms |

Exports updated in `index.ts`, `types/index.ts`, `entities/index.ts`,
`core/index.ts`. Viz (`Mermaid`/`Cytoscape`/`JsonLd`/`CompositeLayout`), `derive`
(`DAGDeriver`/`DAGDeriverAnnotations`), and `validation/Validator.ts` switch the
two old `@type`s to `ScatterNode`.

## Dispatch waves

Reviewed at every boundary (Opus runs whole-package typecheck/lint/test before the
next wave). Files within a wave are disjoint unless marked single-agent.

1. **Entities + core (single agent, shared schema files).** `ScatterNode`,
   `GatherConfig`, `GatherStrategy` const; `GatherStrategies` (+`map`);
   `OutcomeReducers`; `DAG.ts` `oneOf` + `DAG_CONTEXT`; all barrel exports. Package
   typecheck passes for the entity/core layer.
2. **Dispatcher (single agent, depends on W1).** `executeScatter`; delete the two
   branches + `mapOutputState`; generalize resume; wire gather + reducer; validate
   `ScatterNode`. Package typecheck + the engine's own dispatch tests rewritten
   enough to compile.
3. **Builder (single agent, depends on W1).** `.scatter()` + `ScatterOptionsInterface`
   + typed paths; delete `fanOut`/`embeddedDAG`.
4. **Peripherals (parallel — viz, derive, validation are disjoint).** Switch
   `@type` handling to `ScatterNode`.
5. **Tests (parallel by file).** Rewrite `fanout-resume`, `fanin`, `embedded-dag-*`,
   `typed-state-mapping`, `derive`, the viz-renderer tests, `schema`, `dagonizer`,
   `registries`, `per-entity-validators` to the new contract. Add scatter coverage:
   generate-collect (`map` at N), singleton (`map` at 1 = old embedded), partition,
   resume-no-double-append, aggregate vs terminal reducers, source-absent vs present.
6. **Examples + the-archivist (parallel by file).** Rewrite `04-fanout.ts`,
   `05-embedded-dags.ts`, `03-schema.ts`, `09`, `10`, `derive.ts`, and
   `the-archivist/dag.ts` + `embedded-dags/*` to `.scatter()`. Add a
   generate-and-select example (fan out over providers → each writes a candidate →
   `gather: { strategy: 'map', mapping: { candidate: 'candidates' } }` → select node).
7. **Docs (parallel by file).** Rewrite every guide/example/reference page in
   present tense to describe `ScatterNode`/`gather`/`reducer` as the only contract.
   Add the `## [unreleased]` CHANGELOG entry (breaking: fan-out + embedded-DAG
   unified into scatter).

Gate the whole body of work behind full CI (typecheck, lint `--max-warnings 0`,
test) before the merge.
