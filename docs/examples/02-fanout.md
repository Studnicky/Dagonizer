---
title: 'Phase 02 · Fan-out scout'
description: 'Four-source parallel scout cluster in the Archivist — OpenLibrary, Google Books, Subject search, and Wikipedia run concurrently, combine with the collect strategy, then feed rank and merge.'
---

# Phase 02 · Fan-out scout

[The Archivist](./the-archivist) queries four book sources at once: OpenLibrary keyword search, Google Books, OpenLibrary subject search, and Wikipedia enrichment. All four scouts run in a `parallel` placement with `combine: 'collect'` — the fan-in waits for all four and merges their `state.candidates` mutations before routing forward to rank and merge. The `BookSearchFanoutDAG` packages this entire cluster as a reusable sub-DAG.

## Flow

```mermaid
flowchart TB
  extract[bsf-extract-query]
  decide[bsf-decide-tools]
  fan{{book-search-fan-out\nparallel collect}}
  ol([bsf-ol OpenLibrary])
  gb([bsf-gb Google Books])
  sub([bsf-subject Subject])
  wiki([bsf-wiki Wikipedia])
  rank[bsf-rank-candidates]
  merge[bsf-merge-candidates]
  record[bsf-record-findings]
  gate[bsf-has-citations-gate]
  recall([bsf-recall-past-visits])
  END([success / error])
  extract --> decide
  decide --> fan
  fan --> ol & gb & sub & wiki
  ol & gb & sub & wiki --> rank
  rank --> merge
  merge -->|ranked| record
  merge -->|empty| END
  record --> gate
  gate -->|pass| recall
  gate -->|fail| END
  recall --> END
```

## Code

The complete `BookSearchFanoutDAG` — the actual sub-DAG the Archivist places three times for on-topic, author, and similar-search branches:

<<< ../../examples/the-archivist/subdags/BookSearchFanoutDAG.ts

## What it demonstrates

- **`parallel` placement** — `.parallel('book-search-fan-out', ['bsf-ol', 'bsf-gb', 'bsf-subject', 'bsf-wiki'], 'collect', routes)` runs all four scout nodes concurrently. `combine: 'collect'` waits for every branch and merges their state mutations before routing forward.
- **Scout gating via `state.toolPlan`** — each scout checks `state.toolPlan` before making a network call. `decideTools` (an LLM call) populates the plan; scouts that find no matching plan entry return `'empty'` immediately. `wikipediaScout` is the exception — it runs on terms alone, always.
- **`scoutRetry` pass-through** — every scout calls `scoutRetry.run(() => tool.execute(..., context.signal), context.signal)`. The signal propagates from the dispatcher through the retry policy — if the parent flow is cancelled, retries abort mid-backoff.
- **Aggregate routing** — the `parallel` node reports `'success'`, `'error'`, or a partial aggregate once all branches settle. Both `'success'` and `'error'` route to `bsf-rank-candidates` here — the cluster always attempts ranking regardless of partial failures.
- **Molecular `registerBookSearchFanoutNodes`** — the exported helper registers the exact node set the sub-DAG needs. Call it before `dispatcher.registerDAG(BookSearchFanoutDAG)`.

See this in action in the [Archivist live demo](./the-archivist).

## See also

- [Running domain: The Archivist](./the-archivist)
- [Phase 01 · Linear intake](./01-linear)
- [Phase 03 · Sub-DAG fallback](./03-subflows)
- [Reference: Core — `FanInStrategies`](../reference/core)
- [Reference: Entities — `ParallelNode`](../reference/entities)
