---
title: 'Example 34: Intake Stream Source'
description: 'The Cartographer uses first-class intake entrypoints plus an intake gather to assemble bounded async source streams before the processing scatter.'
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

# Example 34: Intake Stream Source

## What It Is

Intake Stream Source is the Cartographer’s open-input pattern: each event type enters as a DAG entrypoint label, every label targets `intake-gather`, and the gather writes one merged async stream into `state.sources` for `process-stream`.

The graph shows the intake explicitly. There is no seed pre-phase and no scatter before the gather.

## How It Works

The scheduler seeds one gather record per entrypoint label because all five labels target the same `GatherNode`. The `source-intake` gather opens the matching event-type stream from `state.eventConfig`, round-robins the streams into a single `AsyncIterable<SourcePayload>`, and assigns that stream to `state.sources`. The scatter reads from that field using the normal source accessor and pulls the next item only when concurrency and reservoir capacity allow it.

This keeps streaming as a DAG concern without a special streaming placement. The intake is a gather, the processor is a scatter, and both are visible in JSON-LD.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Cartographer](./the-cartographer) enters through five data-type entrypoints. Each entrypoint targets `intake-gather`; only after the gather completes does `process-stream` consume `state.sources`.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer streaming source DAG" aria-label="Cartographer streaming source JSON-LD DAG beside Mermaid generated from it." />

The stream source is not a hidden host-side setup step. JSON-LD shows the graph shape: data-type entrypoint labels, first-class gather, then the worker-capable scatter.

### Run

```bash
npm run docs:dev
```

Open [The Cartographer](./the-cartographer) and run the stream.

## What It Lets You Do

Intake stream sources let entrypoints supply async data without materializing the full input collection first. Use this when different domains or data types should enter a DAG independently before converging into one processing stream.

For applications, the useful property is clarity: intake shape is graph-visible, while the scatter still controls how quickly work is drained through concurrency and reservoir settings.

## Code Samples

`CartographerSourceIntake` owns per-type stream construction:

<<< @/../examples/the-cartographer/nodes/sourceIntake.ts#source-intake-helper

`SourceIntakeGather` merges the entrypoint records into the stream that `process-stream` consumes:

<<< @/../examples/the-cartographer/core/SourceIntakeGather.ts#source-intake-gather

## Details for Nerds

- **Bounded streaming source.** The scatter consumes an `AsyncIterable<SourcePayload>` without materializing the whole feed.
- **Back-pressure by pull rate.** The scatter controls drain speed through concurrency and reservoir settings.
- **Graph-visible intake.** Switching from one producer to many producers changes DAG topology intentionally: the gather is the intake point.
- **Runnable browser ownership.** The Cartographer page exposes event count, worker pool size, and batch capacity controls for the same stream.

## Related Concepts

- [Example 17: Async source](./17-scatter-async-source) - async-iterable scatter source in the same Cartographer DAG
- [Example 35: Stream resume](./35-stream-fanin-resume) - durable cursor resume on the Cartographer stream
- [Streaming Producers](../guide/streaming-producers) - full streaming API: driven, fanIn, resumable, DagStreamProducer
