---
title: 'Example 34: Producer Feed DAGs'
description: 'The Cartographer gives each source its own feed/unpack/normalize DAG, then converges all producer outputs through one canonical open gather.'
seeAlso:
  - text: 'Example 17: Async source'
    link: './17-scatter-async-source'
    description: 'async-iterable scatter source inside each producer feed DAG'
  - text: 'Example 35: Stream resume'
    link: './35-stream-fanin-resume'
    description: 'durable cursor resume on the Cartographer process-stream scatter'
  - text: 'Streaming Producers'
    link: '../guide/streaming-producers'
    description: 'full streaming API: driven, fanIn, resumable, DagStreamProducer'
---

<script setup lang="ts">
import { cartographerDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 34: Producer Feed DAGs

## What It Is

Producer Feed DAGs are the Cartographer’s open-input pattern: each event type enters through its own embedded `dag-feed-*` placement, opens only that producer’s source stream, runs the same unpack/normalize body, and emits canonical events for a shared gather.

The graph shows the feed-in explicitly. There is no seed pre-phase and no hidden host-side source merge.

## How It Works

Each source entrypoint targets a concrete embedded feed DAG. Inside that DAG, `feed-*` opens a producer-local `AsyncIterable<SourcePayload>`, `unpack-normalize` scatters the payloads through `ingest-source`, and `merge-events` emits one canonical event array for that producer.

The top-level `canonical-feed` gather receives all five producer outputs and writes `state.canonicalEvents`. The shared `process-stream` scatter then enriches that canonical collection through `event-pipeline-typed`.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Cartographer](./the-cartographer) enters through five data-type entrypoints. Each entrypoint targets a producer feed DAG; only after the `canonical-feed` gather completes does `process-stream` consume `state.canonicalEvents`.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer producer feed DAG" aria-label="Cartographer producer feed JSON-LD DAG beside Mermaid generated from it." />

The stream source is not a hidden host-side setup step. JSON-LD shows the graph shape: producer feed DAG placements, first-class gather, then the worker-capable scatter.

### Run

```bash
npm run docs:dev
```

Open [The Cartographer](./the-cartographer) and run the stream.

## What It Lets You Do

Producer feed DAGs let sources supply async data without materializing the full input collection first. Use this when different domains or data types should enter a DAG independently, run source-specific unpacking, and then converge into one canonical processing stream.

For applications, the useful property is clarity: feed ownership is graph-visible, while the scatter still controls how quickly work is drained through concurrency and reservoir settings.

## Code Samples

The producer feed nodes open one stream per event type:

<<< @/../examples/the-cartographer/nodes/producerFeeds.ts#producer-feed-nodes

The producer feed DAGs run unpack/normalize before the open gather:

<<< @/../examples/the-cartographer/embedded-dags/ProducerFeedDAG.ts#producer-feed-dags

The canonical gather is the visible convergence point before the enrichment scatter:

<<< @/../examples/the-cartographer/core/CanonicalFeedGather.ts#canonical-feed-gather

## Details for Nerds

- **Bounded streaming source.** Each producer feed DAG consumes an `AsyncIterable<SourcePayload>` without materializing the whole feed.
- **Back-pressure by pull rate.** The scatter controls drain speed through concurrency and reservoir settings.
- **Graph-visible feed-in.** Switching from one producer to many producers changes DAG topology intentionally: each producer gets its own feed DAG.
- **Runnable browser ownership.** The Cartographer page exposes event count, worker pool size, and batch capacity controls for the same stream.

## Related Concepts

- [Example 17: Async source](./17-scatter-async-source) - async-iterable scatter source inside a producer feed DAG
- [Example 35: Stream resume](./35-stream-fanin-resume) - durable cursor resume on the Cartographer process-stream scatter
- [Streaming Producers](../guide/streaming-producers) - full streaming API: driven, fanIn, resumable, DagStreamProducer
