---
title: 'Example 17: Async Scatter Source'
description: 'ScatterNode over an AsyncIterable source with bounded-concurrency backpressure. The engine normalises Array, Iterable, and AsyncIterable to the same pull interface; the pull loop only calls iterator.next() when a worker slot is free.'
seeAlso:
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body DAG, gather placement, reduce'
  - text: 'Example 16: Scatter resume'
    link: './16-scatter-resume'
    description: 'durable inbox: resumability across abort with async sources'
  - text: 'Example 15: Incremental gather'
    link: './15-incremental-gather'
    description: 'incremental gather: fold results as clones complete'
---

<script setup lang="ts">
import { cartographerDAG } from '../../examples/the-cartographer/dag.ts';
</script>

# Example 17: Async Scatter Source

## Async Source Surface

Async Scatter Source lets a DAG process input that arrives over time instead of forcing the host to build a complete array before execution starts. The Cartographer uses this inside each producer feed DAG: the feed scatter pulls from an `AsyncIterable` only when worker capacity is available.

The runtime normalises `Array`, `Iterable`, and `AsyncIterable` sources to one pull interface. Your DAG still declares a normal scatter; the source value determines whether items are already available or produced lazily.

## Producer-feed Scatter Flow

### DAG registration and diagram

The DAG shape is standard scatter; the source path resolves to an `AsyncIterable` at runtime. [The Cartographer](./the-cartographer) applies this principle directly: five entrypoints target five producer feed DAGs, each feed DAG opens its producer-local `sourceFeed`, and the top-level `source-intake` gather merges the streams before `process-stream`.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer async-source scatter DAG" aria-label="Cartographer JSON-LD DAG beside Mermaid generated from it." />

The scatter `source` field accepts `Array`, `Iterable`, or `AsyncIterable`. The engine normalises all three to the same `AsyncIterator` interface internally. The pull loop only calls `iterator.next()` when a worker slot is free — giving true backpressure: the generator yields no more than `concurrency` items ahead of the slowest worker.

The Cartographer runtime executes the same JSON-LD DAG. Data-type entrypoint labels target `dag-feed-*` placements directly; each feed node opens one per-type async stream and the feed DAG consumes it at bounded concurrency.

### Run

```bash
pnpm run site:dev
```

Visit [The Cartographer](./the-cartographer) and run the stream to watch producer feed DAGs open async sources before the shared scatter starts.

## Pull-backpressure Model

The scatter executor normalises arrays, iterables, and async iterables into one pull interface. It calls `iterator.next()` only when the configured concurrency pool has capacity. That means a producer cannot outrun the slowest workers by more than the pool window, and the same gather/reducer contract applies after each clone completes.

For host authors, the important knob is still scatter concurrency. With `concurrency: 2`, the pull loop keeps at most two body executions in flight and asks the async source for the next item only when one finishes.

## Code Samples

Producer feed nodes create one async stream per event type. Each producer feed DAG scatters that stream through the shared ingestion DAG, and the top-level canonical gather receives the normalized outputs. The DAG snippet shows that async sources remain ordinary scatter inputs.

<<< @/../examples/the-cartographer/nodes/producerFeeds.ts#producer-feed-nodes

<<< @/../examples/the-cartographer/embedded-dags/ProducerFeedDAG.ts#producer-feed-dags

<<< @/../examples/the-cartographer/dag.ts#cartographer-dag

## Operational Uses

Async scatter sources let hosts process streams without materialising the full input collection first. They fit source data that arrives from a generator, file cursor, network feed, channel, or producer DAG while the host still needs backpressure.

The benefit is memory and pacing control. A large import, telemetry stream, or model-produced candidate stream can feed the same scatter/gather machinery as a small array without changing the downstream nodes.

## Runtime Notes

- **`AsyncIterable` as scatter source.** Any async generator or async-iterable value is a valid scatter source. The engine calls `.next()` lazily on each tick of the concurrency pool.
- **Bounded-concurrency backpressure.** With `concurrency=2`, at most two clones run simultaneously. The pull loop does not call `iterator.next()` until a slot frees, capping how far ahead the generator runs. Array sources follow the same discipline — "eagerly available" only affects when data is produced, not the concurrency semantics.
- **Resumability note.** An `AsyncIterable` on state is not captured by `Checkpoint.capture()` — generators are not JSON-serialisable. Cartographer resumes the enrichment scatter after the producer feed DAGs and the `source-intake` gather have emitted a checkpointable `source-payload` array.
- **Shared source path.** The Cartographer **Stream** panel is fed by the same async source path as the DAG.

## Related Concepts

- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body DAG, gather placement, reduce
- [Example 16: Scatter resume](./16-scatter-resume) - durable inbox: resumability across abort with async sources
- [Example 15: Incremental gather](./15-incremental-gather) - incremental gather: fold results as clones complete
