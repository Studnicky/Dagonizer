---
title: 'Example 35: StreamChannel fanIn and resumable producer'
description: 'Merge multiple push producers via StreamChannel.fanIn; resume a scatter deterministically via StreamChannel.resumable and StreamCursor.resumeAfter.'
seeAlso:
  - text: 'Example 34: StreamChannel driven'
    link: './34-stream-channel'
    description: 'single producer bridged via StreamChannel.driven'
  - text: 'Example 16: Scatter resume'
    link: './16-scatter-resume'
    description: 'durable scatter resume using checkpoint and array sources'
  - text: 'Streaming producers guide'
    link: '../guide/streaming-producers'
    description: 'full streaming API: driven, fanIn, resumable, DagStreamProducer'
---

# Example 35: StreamChannel fanIn and resumable producer

This example covers two related features built on `StreamChannel`:

1. **Fan-in merging**: `StreamChannel.fanIn(producers)` launches several `StreamProducerInterface<T>` objects concurrently against a shared channel. The channel closes when all producers settle; the first rejection fails the stream.
2. **Deterministic resume**: `StreamChannel.resumable(producer, resumeAfter)` paired with `StreamCursor.resumeAfter(state, scatterName)` lets a scatter pick up exactly where it left off. The producer regenerates its ordered sequence from the start and skips the first `resumeAfter` emissions — the scatter's durable pull count.

## Code

<<< @/../examples/35-stream-fanin-resume.ts

## DAG definitions

<<< @/../examples/dags/35-stream-fanin-resume.ts

## What it demonstrates

- **`StreamChannel.fanIn(producers, options?)`** — concurrent multi-producer merge. Items from both producers interleave in arrival order; the channel closes after all producers settle; first error fails the channel.
- **`ResumableStreamProducerInterface<T>`** — the producer's `produce(sink, resumeAfter)` signature skips already-consumed items by re-generating the deterministic sequence and fast-forwarding past the first `resumeAfter` ordinals.
- **`StreamCursor.resumeAfter(state, scatterName)`** — reads the scatter checkpoint's pull count from state. Returns 0 on a fresh run. The value is the scatter's durable pull count (items the scatter pulled and acked), not the producer's push count; items buffered-but-unpulled at interruption time are safely re-emitted.
- **No duplicate processing.** The cursor marks the exact count the scatter has durably acknowledged; the producer skips that prefix on resume. Items that were pushed into the buffer but not yet pulled are re-emitted and processed exactly once on the resumed run.

## Run

```bash
npx tsx examples/35-stream-fanin-resume.ts
```
