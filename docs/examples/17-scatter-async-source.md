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

## What It Is

Async Scatter Source lets a DAG process input that arrives over time instead of forcing the application to build a complete array before execution starts. The Cartographer uses this for generated event streams: the scatter pulls from an `AsyncIterable` only when worker capacity is available.

The runtime normalises `Array`, `Iterable`, and `AsyncIterable` sources to one pull interface. Your DAG still declares a normal scatter; the source value determines whether items are already available or produced lazily.

## How It Works

The scatter executor normalises arrays, iterables, and async iterables into one pull interface. It calls `iterator.next()` only when the configured concurrency pool has capacity. That means a producer cannot outrun the slowest workers by more than the pool window, and the same gather/reducer contract applies after each clone completes.

For application authors, the important knob is still scatter concurrency. With `concurrency: 2`, the pull loop keeps at most two body executions in flight and asks the async source for the next item only when one finishes.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The DAG shape is standard scatter; the source path resolves to an `AsyncIterable` at runtime. [The Cartographer](./the-cartographer) is the in-browser runnable for this principle: five intake entrypoints feed `intake-gather`, the gather writes a merged async stream to `state.sources`, and `process-stream` pulls only as worker capacity opens.

<DagJsonMermaid :dag="cartographerDAG" title="Cartographer async-source scatter DAG" aria-label="Cartographer JSON-LD DAG beside Mermaid generated from it." />

The scatter `source` field accepts `Array`, `Iterable`, or `AsyncIterable`. The engine normalises all three to the same `AsyncIterator` interface internally. The pull loop only calls `iterator.next()` when a worker slot is free — giving true backpressure: the generator yields no more than `concurrency` items ahead of the slowest worker.

The browser runner executes the same JSON-LD DAG. Data-type entrypoint labels target `intake-gather` directly; `source-intake` opens those per-type async streams and the scatter consumes the merged stream at bounded concurrency.

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Async scatter sources let applications process streams without materialising the full input collection first. Use this when source data arrives from a generator, file cursor, network feed, channel, or producer DAG and the host needs backpressure.

The benefit is memory and pacing control. A large import, telemetry stream, or model-produced candidate stream can feed the same scatter/gather machinery as a small array without changing the downstream nodes.

## Code Samples

`CartographerSourceIntake` creates one async stream per event type. `SourceIntakeGather` receives entrypoint-label records and merges the matching streams into `state.sources`. The DAG snippet shows that the gather is the intake point and the scatter placement does not need a separate streaming-specific node type.

<<< @/../examples/the-cartographer/nodes/sourceIntake.ts#source-intake-helper

<<< @/../examples/the-cartographer/core/SourceIntakeGather.ts#source-intake-gather

<<< @/../examples/the-cartographer/dag.ts#cartographer-dag

## Details for Nerds

- **`AsyncIterable` as scatter source.** Any async generator or async-iterable value is a valid scatter source. The engine calls `.next()` lazily on each tick of the concurrency pool.
- **Bounded-concurrency backpressure.** With `concurrency=2`, at most two clones run simultaneously. The pull loop does not call `iterator.next()` until a slot frees, capping how far ahead the generator runs. Array sources follow the same discipline — "eagerly available" only affects when data is produced, not the concurrency semantics.
- **Resumability note.** An `AsyncIterable` on state is not captured by `Checkpoint.capture()` — generators are not JSON-serialisable. After an abort with an async source, the resume call must re-provide the generator at the continuation position. Cartographer does that through `CartographerSourceIntake.mergedFor(state, cursor)`.
- **Runnable source.** The Cartographer **Stream** panel is fed by the same async source path as the DAG.

## Related Concepts

- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body DAG, gather placement, reduce
- [Example 16: Scatter resume](./16-scatter-resume) - durable inbox: resumability across abort with async sources
- [Example 15: Incremental gather](./15-incremental-gather) - incremental gather: fold results as clones complete
