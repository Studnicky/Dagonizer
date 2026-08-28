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
import { cartographerDAG } from '../exampleDags.ts';
</script>

# Example 34: Producer Feed DAGs

## Producer Feed Surface

Producer Feed DAGs are the Cartographer’s open-input pattern: each event type enters through its own embedded `dag-feed-*` placement, opens only that producer’s source stream, runs the same unpack/normalize body, and emits canonical events for a shared gather.

The graph shows the feed-in explicitly. There is no seed pre-phase and no hidden source merge outside the DAG.

## Feed-in Topology

### DAG registration and diagram

The [Cartographer](./the-cartographer) enters through five data-type entrypoints. Each entrypoint targets a producer feed DAG; only after the `source-intake` gather completes does `process-stream` consume `state['source-payload']`.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer producer feed DAG" aria-label="Cartographer producer feed JSON-LD DAG beside Mermaid generated from it." />

The stream source is not a hidden setup step outside the DAG. JSON-LD shows the graph shape: producer feed DAG placements, first-class gather, then the worker-capable scatter.

### Run

```bash
pnpm run site:dev
```

Visit [The Cartographer](./the-cartographer) and run the stream.

## Feed DAG and Intake Model

Each source entrypoint targets a concrete embedded feed DAG. Inside that DAG, `feed-*` opens a producer-local `AsyncIterable<SourcePayload>` onto `state.sourceFeed` and routes straight to `done` — unpacking and normalization happen downstream in the shared scatter body, not per producer.

The top-level `source-intake` gather receives all five producer streams and merges them into `state['source-payload']`. The shared `process-stream` scatter then decodes and enriches that payload collection through `stream-event`.

## Code Samples

The producer feed nodes open one stream per event type:

<<< @/../examples/the-cartographer/nodes/producerFeeds.ts#producer-feed-nodes

The producer feed DAGs run unpack/normalize before the open gather:

<<< @/../examples/the-cartographer/embedded-dags/ProducerFeedDAG.ts#producer-feed-dags

The source-intake gather is the visible convergence point before the enrichment scatter:

<<< @/../examples/the-cartographer/core/SourceIntakeGather.ts#source-intake-gather

## Operational Uses

Producer feed DAGs let sources supply async data without materializing the full input collection first. They fit cases where different domains or data types should enter a DAG independently, run source-specific unpacking, and then converge into one canonical processing stream.

For hosts, the useful property is clarity: feed ownership is graph-visible, while the scatter still controls how quickly work is drained through concurrency and reservoir settings.

## Runtime Notes

- **Bounded streaming source.** Each producer feed DAG consumes an `AsyncIterable<SourcePayload>` without materializing the whole feed.
- **Back-pressure by pull rate.** The scatter controls drain speed through concurrency and reservoir settings.
- **Graph-visible feed-in.** Switching from one producer to many producers changes DAG topology intentionally: each producer gets its own feed DAG.
- **Runtime controls.** The Cartographer interactive host exposes event count, worker pool size, and batch capacity controls for the same stream.

## Related Concepts

- [Example 17: Async source](./17-scatter-async-source) - async-iterable scatter source inside a producer feed DAG
- [Example 35: Stream resume](./35-stream-fanin-resume) - durable cursor resume on the Cartographer process-stream scatter
- [Streaming Producers](../guide/streaming-producers) - full streaming API: driven, fanIn, resumable, DagStreamProducer
