# @noocodex/dagonizer-patterns-flow

Pure flow primitives for [@noocodex/dagonizer](https://npmjs.com/package/@noocodex/dagonizer). Deterministic transforms on state — no LLM, no triple store, no HTTP. Just the shape-changing utilities every DAG eventually needs.

## Install

```bash
npm install @noocodex/dagonizer @noocodex/dagonizer-patterns-flow
```

## Taxonomy

```
MonadicNode (root)
└── FlowNode<TState>                          (no services bag)
    ├── SelectNode<TState, TItem>             (pick/sort from list)
    │   ├── PickByScoreNode<TItem>
    │   └── SortByNode<TItem>
    ├── ReduceNode<TState, TItem, TResult>    (collapse a list)
    │   ├── DedupeByKeyNode<TItem>
    │   ├── GroupByFieldNode<TItem, TKey>
    │   └── FanInReducerNode<TState, TItem>
    ├── PredicateGateNode<TState>             ('pass' | 'fail' routing)
    ├── ExtractFieldNode<TState, TValue>      (copy state field)
    └── RespondNode<TState>                   (write draft, mark lifecycle)
```

## Pattern reference

### PickByScoreNode

Pick the single highest-scoring item from a list, write it back as the sole element.

```ts
class PickBestMatch extends PickByScoreNode<MyState, Candidate> {
  readonly name = 'pick-best-match';
  readonly outputs = ['success', 'empty'] as const;

  protected readItems(s: MyState): readonly Candidate[] { return s.candidates; }
  protected writeBack(s: MyState, items: readonly Candidate[]): void { s.shortlist = items; }
  protected score(c: Candidate): number { return c.score; }
}
```

### SortByNode

Sort a list in place; consumer supplies the comparator.

```ts
class RankByRating extends SortByNode<MyState, Candidate> {
  readonly name = 'rank-by-rating';
  readonly outputs = ['success', 'empty'] as const;

  protected readItems(s): readonly Candidate[] { return s.candidates; }
  protected writeBack(s, items): void { s.candidates = items; }
  protected compare(a: Candidate, b: Candidate): number {
    const sa = (a.notes?.rating ?? 0) * Math.log((a.notes?.ratingsCount ?? 1) + 1);
    const sb = (b.notes?.rating ?? 0) * Math.log((b.notes?.ratingsCount ?? 1) + 1);
    return sb - sa;
  }
}
```

### DedupeByKeyNode

Dedupe by computed key — preserves first occurrence.

```ts
class MergeCandidates extends DedupeByKeyNode<MyState, Candidate> {
  readonly name = 'merge-candidates';
  readonly outputs = ['success'] as const;

  protected readItems(s): readonly Candidate[] { return s.candidates; }
  protected writeBack(s, items): void { s.candidates = items; }
  protected keyOf(c: Candidate): string { return c.book.isbn; }
}
```

### GroupByFieldNode

Group items by a field — output is a `ReadonlyMap<TKey, readonly TItem[]>`.

### FanInReducerNode

Bare base for custom fan-in semantics. Override `reduce()` for your collapse logic.

### PredicateGateNode

Boolean gate. Routes to `'pass'` or `'fail'`.

```ts
class HasCitationsGate extends PredicateGateNode<MyState> {
  readonly name = 'has-citations-gate';
  protected predicate(s: MyState): boolean { return s.shortlist.length > 0; }
}
```

### ExtractFieldNode

Copy a value from one state location to another (useful when canonical state buries a field downstream nodes need at top level).

### RespondNode

Terminal node — writes the draft to a consumer-controlled location and marks lifecycle complete.

```ts
class RespondToVisitor extends RespondNode<MyState> {
  readonly name = 'respond-to-visitor';
  protected emit(s: MyState, draft: string): void {
    s.conversation = [...s.conversation, { role: 'agent', text: draft }];
    s.lifecycle = { kind: 'completed' };
  }
}
```

## License

MIT
