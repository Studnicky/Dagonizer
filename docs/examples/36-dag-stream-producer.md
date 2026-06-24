---
title: 'Example 36: DagStreamProducer'
description: 'Bridge an inner DAG execution stream into an outer scatter source via DagStreamProducer. Inner DAG results feed the outer scatter as back-pressured items.'
seeAlso:
  - text: 'Example 34: StreamChannel driven'
    link: './34-stream-channel'
    description: 'single producer bridged via StreamChannel.driven'
  - text: 'Example 20: Streaming execution'
    link: './20-streaming'
    description: 'per-node AsyncIterable execution: streaming node results'
  - text: 'Streaming producers guide'
    link: '../guide/streaming-producers'
    description: 'full streaming API: driven, fanIn, resumable, DagStreamProducer'
---

# Example 36: DagStreamProducer

`DagStreamProducer<T>` is an abstract base class that bridges a running inner DAG's per-node result stream into a push sink, so one DAG's discovered items feed another DAG's scatter as a live, back-pressured source.

Subclass it and implement two methods:
- `executions()` — returns an `AsyncIterable<NodeResultType<NodeStateInterface>>` (a per-node streaming execution of the inner DAG).
- `select(stage)` — yields zero or more items from each node result.

`produce` drives the inner execution and pushes each selected item. Because `sink.push` is awaited, the inner DAG is back-pressured by the outer scatter's drain rate.

## Code

<<< @/../examples/36-dag-stream-producer.ts

## DAG definitions

<<< @/../examples/dags/36-dag-stream-producer.ts

## What it demonstrates

- **`DagStreamProducer<T>` subclassing** — extend the abstract class, implement `executions()` to run the inner DAG in streaming mode and `select(stage)` to extract items from each per-node result.
- **Inner DAG as item source** — each node result from the inner DAG passes through `select`; only results carrying the desired data emit items downstream.
- **Back-pressure across DAG boundaries** — the outer scatter's concurrency cap back-pressures the inner DAG via `sink.push`; both DAGs are in-flight simultaneously, bounded by `capacity`.
- **`StreamChannel.driven(producer, options?)`** bridges the `DagStreamProducer` into the scatter source.

## Run

```bash
npx tsx examples/36-dag-stream-producer.ts
```
