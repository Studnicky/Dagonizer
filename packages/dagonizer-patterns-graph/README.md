# @studnicky/dagonizer-patterns-graph

Triple-store-driven node pattern bases for [@studnicky/dagonizer](https://npmjs.com/package/@studnicky/dagonizer). Patterns that read from and write to an RDF quad store via SPARQL-shaped basic graph patterns.

## Install

```bash
npm install @studnicky/dagonizer @studnicky/dagonizer-patterns-graph
```

## Taxonomy

```
MonadicNode (root)
└── GraphNode<TState>                   (injects a TripleStore via its constructor)
    ├── RecallContextNode<TState, TBinding>
    ├── RecordFindingsNode<TState, TEntity>
    └── MemoryDigestNode<TState, TDigest>
```

## Dependency injection

Each pattern receives a `TripleStoreInterface` through its constructor and holds
it as `this.memory` — there is no ambient services record. The canonical
interface lives at `@studnicky/dagonizer/patterns`; any n3-backed quad store
satisfies it. Construct the node with the store and register it:

```ts
const node = new MyRecallContextNode(tripleStore);
dispatcher.registerNode(node);
```

## Pattern reference

### RecallContextNode

SPARQL select against the memory store; map raw bindings into the consumer's domain shape; write to state.

```ts
class RecallBooksByYear extends RecallContextNode<MyState, BookBinding> {
  readonly name = 'recall-books-by-year';
  readonly outputs = ['success', 'empty'] as const;

  protected buildQuery(s: MyState): SlotPattern {
    return { subject: '?book', predicate: dag('firstPublishYear'), object: lit.int(s.year), graph: '?g' };
  }
  protected mapBindings(rows): readonly BookBinding[] { /* … */ }
  protected applyRecall(s, books): void { s.recalledBooks = books; }
}
```

### RecordFindingsNode

Write a batch of entities back into the store as quads.

```ts
class RecordCandidates extends RecordFindingsNode<MyState, Candidate> {
  readonly name = 'record-candidates';
  readonly outputs = ['success'] as const;

  protected selectEntities(s: MyState): readonly Candidate[] { return s.shortlist; }
  protected toQuads(c: Candidate): readonly Quad[] { /* … */ }
}
```

### MemoryDigestNode

Assemble a structured digest of recent activity (counts, recent titles, intent frequencies) and write to state.

```ts
class RecallActivity extends MemoryDigestNode<MyState, MyDigest> {
  readonly name = 'recall-activity';
  readonly outputs = ['success'] as const;

  protected buildDigest(store: TripleStore, s: MyState): MyDigest { /* … */ }
  protected applyDigest(s: MyState, digest: MyDigest): void { s.digest = digest; }
}
```

## RdfStore

`RdfStore` is an in-process quad store that implements **both** the `Store` contract (key-value via RDF reification) and the `TripleStore` contract (native quad operations). It ships in this package so plugin authors that already depend on `@studnicky/dagonizer-patterns-graph` for the graph node patterns get a concrete, zero-dependency store to back those patterns.

```ts
import { RdfStore } from '@studnicky/dagonizer-patterns-graph';

const store = new RdfStore();

// Store contract: reifies key-value as a triple.
await store.set('tokenBudget', 4096);
const raw = await store.get('tokenBudget');
const budget = typeof raw === 'number' ? raw : 0; // 4096

// TripleStore contract: native quad operations.
store.assert(
  { termType: 'NamedNode', value: 'urn:doc:1' },
  { termType: 'NamedNode', value: 'urn:pred:author' },
  { termType: 'Literal',   value: 'Alice' },
);

const rows = store.select({ predicate: { termType: 'NamedNode', value: 'urn:pred:author' }, subject: '?doc' });
// rows[0]['doc'].value === 'urn:doc:1'
```

The backing is a plain `Quad[]` with no external dependencies. Pass it to the
constructor of the `RecallContextNode`, `RecordFindingsNode`, and
`MemoryDigestNode` patterns.

### Reification scheme

`set(key, value)` serialises `value` as JSON and writes a single quad:

```
<urn:dagonizer:store:{key}> <urn:dagonizer:store:value> "{json}" .
```

The subject prefix and value predicate are configurable via `RdfStoreOptions`.

### Snapshot contract

`snapshot()` captures only the Store-reified quads. User-asserted quads on
other predicates are considered ephemeral graph data and are excluded.
`restore()` replaces the entire backing array; both reified and user-asserted
quads are cleared, then the snapshot entries are reseeded. Plugin authors that
need to preserve non-reified quads across restore should subclass `RdfStore`
and override `performRestoreEntries`.

## License

MIT
