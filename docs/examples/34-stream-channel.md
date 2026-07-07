---
title: 'Example 34: StreamChannel Source'
description: 'The Cartographer bridges its resumable event producer into the scatter source with StreamChannel.resumable, giving the in-browser pipeline bounded streaming input.'
seeAlso:
  - text: 'Example 17: Async source'
    link: './17-scatter-async-source'
    description: 'async-iterable scatter source in the same Cartographer DAG'
  - text: 'Example 35: Stream resume'
    link: './35-stream-fanin-resume'
    description: 'durable cursor resume on the Cartographer stream'
  - text: 'Streaming Producers'
    link: '../guide/streaming-producers'
    description: 'full streaming API: driven, fanIn, resumable, DagStreamProducer'
---

<script setup lang="ts">
import { cartographerDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 34: StreamChannel Source

## What It Is

StreamChannel Source bridges a producer into a scatter source without changing the DAG topology. The Cartographer uses `StreamChannel.resumable(...)` to feed bounded streaming input into `process-stream`.

The graph still says `seed → process-stream → summarize`. The channel is how the seed step supplies data to the scatter.

## How It Works

The seed node assigns an async channel to `state.sources`. The scatter reads from that field using the normal source accessor and pulls the next item only when concurrency and reservoir capacity allow it. The channel applies back-pressure to the producer, so producer speed cannot outrun the DAG's configured drain rate.

This keeps streaming as an input concern. The scatter, gather, reducer, and downstream summary nodes do not need a streaming-specific placement type.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Cartographer](./the-cartographer) seeds `state.sources` before the `process-stream` scatter runs. When streaming is enabled, that source is a `StreamChannel.resumable(...)` channel backed by `CartographerStreamProducer`.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer streaming source DAG" aria-label="Cartographer streaming source JSON-LD DAG beside Mermaid generated from it." />

`StreamChannel` is not a separate graph node. It is the bounded data source consumed by the scatter. That means JSON-LD shows the graph shape (`seed → process-stream → summarize`), while code shows how the source is supplied.

### Run

```bash
npm run docs:dev
```

Open [The Cartographer](./the-cartographer) and run the stream.

## What It Lets You Do

`StreamChannel` lets a producer push items while scatter consumes them as an `AsyncIterable`. Use it when the full input is not available up front or should not be materialized in memory: browser events, server-sent events, file reads, model-token streams, queue drains, or generated worksets.

For applications, the useful property is pressure control. The producer can exist independently, but the DAG controls how quickly work is drained through scatter concurrency and reservoir settings.

## Code Samples

`SeedEventsNode` chooses the streaming path and assigns the channel to `state.sources`:

<<< @/../examples/the-cartographer/nodes/seedEvents.ts#seed-events-node

`EventStreamSource` owns the lazy producer and the resumable producer factory:

<<< @/../examples/the-cartographer/services/EventStreamSource.ts#event-stream-source

## Details for Nerds

- **Bounded streaming source.** The scatter consumes an `AsyncIterable<SourcePayload>` without materializing the whole feed.
- **Back-pressure by pull rate.** The producer pushes through `StreamChannel`, and the scatter controls drain speed through concurrency and reservoir settings.
- **Graph stays stable.** Switching array input to streaming input changes state seeding, not DAG topology.
- **Runnable browser ownership.** The Cartographer page exposes event count, worker pool size, and batch capacity controls for the same stream.

## Related Concepts

- [Example 17: Async source](./17-scatter-async-source) - async-iterable scatter source in the same Cartographer DAG
- [Example 35: Stream resume](./35-stream-fanin-resume) - durable cursor resume on the Cartographer stream
- [Streaming Producers](../guide/streaming-producers) - full streaming API: driven, fanIn, resumable, DagStreamProducer
