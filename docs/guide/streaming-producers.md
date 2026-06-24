---
title: 'Streaming producers'
description: 'Bridge push producers into scatter sources via StreamChannel: driven, fanIn, resumable, and DagStreamProducer. Back-pressure keeps peak memory O(capacity).'
---

# Streaming producers

A scatter source accepts any `AsyncIterable<T>`. `StreamChannel<T>` bridges push-style producers into that pull loop: a producer calls `await sink.push(item)` for each item it discovers; `push` awaits when the bounded buffer is full, giving the scatter time to drain a slot. Peak memory stays O(capacity) rather than O(total items) — a producer that discovers millions of items never buffers more than `capacity` of them at once.

## StreamChannel.driven

`StreamChannel.driven(producer, options?)` wires one `StreamProducerInterface<T>` to a bounded channel. The producer's `produce(sink)` runs in the background; the channel is returned immediately and assigned to the scatter source field before `dispatcher.execute` is called.

```ts
import { StreamChannel } from '@studnicky/dagonizer';
import type { StreamProducerInterface, StreamSinkInterface } from '@studnicky/dagonizer';

class NumberProducer implements StreamProducerInterface<number> {
  readonly #count: number;
  constructor(count: number) { this.#count = count; }
  static of(count: number): NumberProducer { return new NumberProducer(count); }

  async produce(sink: StreamSinkInterface<number>): Promise<void> {
    for (let i = 0; i < this.#count; i++) {
      await sink.push(i);
    }
  }
}

state.source = StreamChannel.driven(NumberProducer.of(10), { capacity: 4 });
```

The `capacity` option (default 256) is the maximum number of items buffered before `push` awaits. `signal` lets callers abort the channel mid-stream.

## StreamChannel.fanIn

`StreamChannel.fanIn(producers, options?)` launches several `StreamProducerInterface<T>` objects concurrently against a shared channel. The channel closes when all producers settle (resolved). The first rejection fails the channel; subsequent `push` calls from other producers receive a rejection and unwind naturally.

```ts
import { StreamChannel } from '@studnicky/dagonizer';

state.source = StreamChannel.fanIn([
  RangeProducer.range(0, 5),
  RangeProducer.range(10, 15),
]);
```

Items from both producers interleave in arrival order. The single consumer (scatter) is the sole reader; JavaScript's event-loop serialization keeps the shared buffer mutation safe without locking.

## StreamChannel.resumable

`StreamChannel.resumable(producer, resumeAfter, options?)` drives a `ResumableStreamProducerInterface<T>`. The producer receives `resumeAfter` as a second argument to `produce(sink, resumeAfter)` and skips its first `resumeAfter` emissions — reproducing its deterministic sequence from the start and fast-forwarding past the prefix the scatter has already acknowledged.

```ts
import { StreamChannel, StreamCursor } from '@studnicky/dagonizer';
import type { ResumableStreamProducerInterface, StreamSinkInterface } from '@studnicky/dagonizer';

class DeterministicProducer implements ResumableStreamProducerInterface<number> {
  readonly #total: number;
  constructor(total: number) { this.#total = total; }
  static of(total: number): DeterministicProducer { return new DeterministicProducer(total); }

  async produce(sink: StreamSinkInterface<number>, resumeAfter: number): Promise<void> {
    for (let i = resumeAfter; i < this.#total; i++) {
      await sink.push(i);
    }
  }
}

// First run
state.source = StreamChannel.resumable(DeterministicProducer.of(20), 0);
await dispatcher.execute('my-dag', state);

// Resume from where the scatter left off
const resumeAfter = StreamCursor.resumeAfter(state, 'scatter-node-name');
state.source = StreamChannel.resumable(DeterministicProducer.of(20), resumeAfter);
await dispatcher.execute('my-dag', state);
```

`StreamCursor.resumeAfter(state, scatterName)` reads the scatter's durable pull count (`nextIndex`) from the state checkpoint. It returns 0 on a fresh run. The cursor is the PULL count — items buffered but not yet pulled at interruption time are re-emitted on resume with no duplicates.

## DagStreamProducer

`DagStreamProducer<T>` is an abstract base class (exported from `@studnicky/dagonizer`) that bridges a running inner DAG's per-node result stream into a push sink. Subclass it and implement:

- `protected abstract executions(): AsyncIterable<NodeResultType<NodeStateInterface>>` — run the inner DAG in streaming mode. `Dagonizer.execute(dagName, state)` returns an `Execution<TState>` which is both `AsyncIterable<NodeResultType<NodeStateInterface>>` and `PromiseLike`.
- `protected abstract select(stage: NodeResultType<NodeStateInterface>): Iterable<T>` — yield zero or more items from each node result. Return an empty array `[]` to skip a stage.

`produce` is already implemented: it iterates `executions()` and awaits `sink.push(item)` for every item yielded by `select`. The inner DAG is therefore back-pressured at the outer scatter's drain rate.

```ts
import { DagStreamProducer, Dagonizer } from '@studnicky/dagonizer';
import type { NodeResultType, NodeStateInterface } from '@studnicky/dagonizer';

class LabelStreamProducer extends DagStreamProducer<string> {
  readonly #values: number[];
  constructor(values: number[]) {
    super();
    this.#values = values;
  }
  static of(values: number[]): LabelStreamProducer {
    return new LabelStreamProducer(values);
  }

  async *#runAll(): AsyncGenerator<NodeResultType<NodeStateInterface>> {
    const dispatcher = new Dagonizer<InnerState>();
    dispatcher.registerNode(new GenerateNode());
    dispatcher.registerDAG(innerDag);
    for (const v of this.#values) {
      const state = new InnerState();
      state.value = v;
      for await (const stage of dispatcher.execute('inner-stream', state)) {
        yield stage;
      }
    }
  }

  protected executions(): AsyncIterable<NodeResultType<NodeStateInterface>> {
    return this.#runAll();
  }

  protected select(stage: NodeResultType<NodeStateInterface>): Iterable<string> {
    const s = stage.state;
    if (s instanceof InnerState && s.label !== '') {
      return [s.label];
    }
    return [];
  }
}
```

Use it with `StreamChannel.driven`:

```ts
state.source = StreamChannel.driven(LabelStreamProducer.of([0, 1, 2, 3, 4]));
```

## API reference

| Symbol | Subpath |
|--------|---------|
| `StreamChannel<T>` | `@studnicky/dagonizer` or `@studnicky/dagonizer/channels` |
| `StreamCursor` | `@studnicky/dagonizer` or `@studnicky/dagonizer/channels` |
| `StreamChannelOptionsType` | `@studnicky/dagonizer` or `@studnicky/dagonizer/channels` |
| `StreamCursorOptionsType` | `@studnicky/dagonizer` or `@studnicky/dagonizer/channels` |
| `StreamChannelInterface<T>` | `@studnicky/dagonizer` or `@studnicky/dagonizer/channels` |
| `StreamSinkInterface<T>` | `@studnicky/dagonizer` or `@studnicky/dagonizer/contracts` |
| `StreamProducerInterface<T>` | `@studnicky/dagonizer` or `@studnicky/dagonizer/contracts` |
| `ResumableStreamProducerInterface<T>` | `@studnicky/dagonizer` or `@studnicky/dagonizer/contracts` |
| `DagStreamProducer<T>` | `@studnicky/dagonizer` or `@studnicky/dagonizer/patterns` |
