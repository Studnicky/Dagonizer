---
title: 'Example 34: StreamChannel driven producer'
description: 'Bridge a PUSH producer into a scatter source via StreamChannel.driven. Back-pressure keeps peak memory bounded to the channel capacity.'
seeAlso:
  - text: 'Example 17: Async source'
    link: './17-scatter-async-source'
    description: 'async-iterable scatter source: generator-based lazy pull'
  - text: 'Streaming producers guide'
    link: '../guide/streaming-producers'
    description: 'full streaming API: driven, fanIn, resumable, DagStreamProducer'
---

# Example 34: StreamChannel driven producer

`StreamChannel.driven(producer)` bridges a push-style producer into the pull-based scatter loop. A `StreamProducerInterface<T>` calls `await sink.push(item)` for each item; back-pressure applies automatically — `push` awaits when the channel buffer is full and the consumer (scatter) has not drained a slot yet. Peak memory stays bounded at O(capacity), not O(total items).

## Code

<<< @/../examples/34-stream-channel.ts

## DAG definition

<<< @/../examples/dags/34-stream-channel.ts

## What it demonstrates

- **`StreamChannel.driven(producer, options?)`** — wires a `StreamProducerInterface<T>` to a bounded channel. The channel is returned immediately; `producer.produce(channel)` runs in the background, closing the channel when it resolves.
- **Back-pressure.** With `{ capacity: 4 }`, the channel holds at most 4 items. The producer's `push` awaits whenever the buffer is full, resuming when the scatter consumer pulls the next item. Item production and scatter execution interleave rather than buffering everything up front.
- **`AsyncIterable<T>` as scatter source.** Assigning a `StreamChannel<T>` to a state field works identically to assigning an async generator — the scatter engine calls `[Symbol.asyncIterator]()` in both cases.

## Run

```bash
npx tsx examples/34-stream-channel.ts
```
