---
title: 'Example 17: Scatter async source'
description: 'ScatterNode over an AsyncIterable source with bounded-concurrency backpressure. The engine normalises Array, Iterable, and AsyncIterable to the same pull interface; the pull loop only calls iterator.next() when a worker slot is free.'
seeAlso:
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Example 16: Scatter resume'
    link: './16-scatter-resume'
    description: 'durable inbox: resumability across abort with async sources'
  - text: 'Example 15: Incremental gather'
    link: './15-incremental-gather'
    description: 'incremental gather: fold results as clones complete'
---

# Example 17: Scatter async source

The scatter `source` field accepts `Array`, `Iterable`, or `AsyncIterable`. The engine normalises all three to the same `AsyncIterator` interface internally. The pull loop only calls `iterator.next()` when a worker slot is free — giving true backpressure: the generator yields no more than `concurrency` items ahead of the slowest worker.

This example sets `state.stream` to an async generator and uses `concurrency=2`. An event log records every "pull" (generator yields) and "process" (worker runs) event in call order. The interleaving proves that items 2+ are only pulled after worker slots free — the generator is held back by the pool.

## Code

<<< @/../examples/17-scatter-async-source.ts

## What it demonstrates

- **`AsyncIterable` as scatter source.** Any async generator or async-iterable value is a valid scatter source. The engine calls `.next()` lazily on each tick of the concurrency pool.
- **Bounded-concurrency backpressure.** With `concurrency=2`, at most two clones run simultaneously. The pull loop does not call `iterator.next()` until a slot frees, capping how far ahead the generator runs. Array sources follow the same discipline — "eagerly available" only affects when data is produced, not the concurrency semantics.
- **Resumability note.** An `AsyncIterable` on state is not captured by `Checkpoint.capture()` — generators are not JSON-serialisable. After an abort with an async source, the resume call must re-provide the generator at the continuation position. Acked items are skipped via the `ackedResults` index (no re-execution). For fully durable sources, prefer an array source and rely on checkpoint's acked-index tracking.
- **Event log inspection.** The pull/process interleaving in the output confirms that `iterator.next()` is only called when a concurrency slot opens.

## Run

```bash
npx tsx examples/17-scatter-async-source.ts
```
