# @noocodex/dagonizer-patterns-graph

Triple-store-driven node pattern bases for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Patterns that read from and write to an RDF quad store via SPARQL-shaped basic graph patterns.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-patterns-graph
```

## Taxonomy

```
MonadicNode (root)
└── GraphNode<TState>                   (uses services.memory: TripleStore)
    ├── RecallContextNode<TState, TBinding>
    ├── RecordFindingsNode<TState, TEntity>
    └── MemoryDigestNode<TState, TDigest>
```

## Services contract

Every pattern expects `services.memory: TripleStore` (the canonical interface lives at `@noocodex/dagonizer/patterns`). Any n3-backed quad store satisfies it.

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

## License

MIT
