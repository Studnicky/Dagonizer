---
title: 'Example 15: Incremental Gather'
description: 'Incremental vs batch scatter gather. GatherStrategy subclasses implement reduce (called per-clone as results arrive) and finalize (called once after all clones complete). Built-in strategies fold in reduce; the built-in custom strategy accumulates nothing in reduce and does all work in finalize.'
seeAlso:
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'collect vs discard: two gather strategies side-by-side'
  - text: 'Example 16: Scatter resume'
    link: './16-scatter-resume'
    description: 'durable-inbox checkpoint and resume across a scatter abort'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

<script setup lang="ts">
import { cartographerDAG } from '../../examples/the-cartographer/dag.ts';
</script>

# Example 15: Incremental Gather

## What It Is

Incremental Gather is for scatter work where parent state should become useful before every clone finishes. The Cartographer folds completed stream records into insight aggregates as they arrive, so the UI can show progress without materialising the entire event stream.

The core distinction is `reduce` versus `finalize`: fold clone results as they arrive, or wait and merge once at the end.

## How It Works

The scatter executor calls the strategy's `reduce` hook as clone batches complete. `InsightsFoldGather` reads each clone result, updates bounded parent aggregates, and leaves the final `finalize` hook with little to do. A batch-style strategy can do the opposite: keep `reduce` empty and perform one final merge in `finalize`.

Application code chooses the timing based on product needs. Dashboards and streaming ETL usually want incremental fold; all-at-once ranking or reconciliation may prefer `finalize`.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The in-browser [Cartographer](./the-cartographer) is the real incremental gather example. `process-stream` folds each completed clone into `state.insights`, `state.journeys`, and `state.sampleRecords` as records arrive; the UI reads those evolving aggregates while the stream is running.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer incremental gather DAG" aria-label="Cartographer JSON-LD DAG beside Mermaid generated from it." />

Every `GatherStrategy` subclass implements the fold contract:

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Incremental gather lets applications fold completed scatter clones into parent state as they finish instead of waiting for every clone to complete. Use it for streaming dashboards, large ETL jobs, and bounded-memory aggregates where the parent state should become useful during the scatter.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

<<< @/../examples/the-cartographer/core/InsightsFoldGather.ts

<<< @/../examples/the-cartographer/dag.ts#cartographer-dag

## Details for Nerds

- **`reduce` hook.** `InsightsFoldGather` folds each clone into bounded parent aggregates immediately after that clone completes.
- **`reduce(config, batch, state, accessor)`** — called once per clone (or per micro-batch) as results arrive. Override this to fold incrementally. Parent state grows after each clone completes.
- **`finalize(config, execution)`** — called once after all clones complete. Override this (and leave `reduce` as a no-op) for all-at-once processing.

The built-in `map`, `append`, `collect`, and `partition` strategies fold in `reduce` — parent state grows after each clone. The built-in `custom` strategy accumulates nothing in `reduce` and does its work in `finalize`.

The Cartographer uses the incremental path because the runnable page can stream many source events without materialising every enriched record in parent memory.

- **Bounded memory.** Parent state holds rollups and samples, not the full event stream.
- **UI-visible progress.** The browser panels update from the same aggregate state the DAG produces.
- **Registry by name.** The DAG JSON-LD only says `gather: { strategy: 'insights-fold' }`; the runnable imports the strategy module to register the implementation.

## Related Concepts

- [Example 14: Gather strategies](./14-gather-strategies) - collect vs discard: two gather strategies side-by-side
- [Example 16: Scatter resume](./16-scatter-resume) - durable-inbox checkpoint and resume across a scatter abort
- [Reference: Core, GatherStrategies](../reference/core)
