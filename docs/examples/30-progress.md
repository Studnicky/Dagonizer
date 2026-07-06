---
title: 'Example 30: EventBus and SseStream'
description: 'In-process pub/sub and SSE streaming via EventBus and SseStream. Wire Dagonizer lifecycle hooks to a bus topic so multiple consumers observe the same run without multiplexing hook overrides.'
seeAlso:
  - text: 'Observability guide'
    link: '../guide/observability'
    description: 'full hook reference and EventBus multiplexing patterns'
  - text: 'Example 18: Observability'
    link: './18-observability'
    description: 'subclass hooks: onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError'
  - text: 'Example 20: Streaming execution'
    link: './20-streaming'
    description: 'async-iterable execution API: per-node progress events'
---

# Example 30: EventBus and SseStream

The `@studnicky/dagonizer/progress` submodule ships a transport-agnostic progress substrate built on two primitives:

- **`EventBus`** — synchronous, in-process, topic-keyed publish/subscribe. Domain-free, zero dependencies, isomorphic (Node and browser).
- **`SseStream`** — wraps an `EventBus` subscription in a web-standard `ReadableStream<string>` of Server-Sent Events frames. Works as an HTTP response body in any fetch-compatible server (Deno, Bun, Node 18+ `http`, Hono, Express, Cloudflare Workers).

Both primitives are independent. You can use `EventBus` without `SseStream`, `SseStream` without an HTTP server, or wire them together for a full observability pipeline.

## Code

<<< @/../examples/30-progress.ts

## DAG definition

<<< @/../examples/dags/30-progress.ts

## What it demonstrates

### Part 1 — EventBus pub/sub

`EventBus.subscribe` returns an unsubscribe handle. Call it at any time to stop delivery without affecting sibling subscribers. A listener that throws is caught and ignored; other listeners on the same publish call still fire.

```ts
import { EventBus } from '@studnicky/dagonizer/progress';

const bus = new EventBus();
const unsub = bus.subscribe('runs', (event) => console.log(event.payload));
bus.publish('runs', { nodeId: 'fetch' });
unsub(); // deregister
bus.dispose(); // drop all listeners on all topics
```

### Part 2 — SseStream: bus topic to SSE frames

`SseStream.of(bus, topics, options?)` returns an `SseStream` with a `readable: ReadableStream<string>`. Pipe it directly as an HTTP response body.

Wire format:
- First chunk: `data: {"connected":true}\n\n` — lets clients detect stream open.
- Subsequent chunks: `data: <json envelope>\n\n` — one frame per bus publish.
- Heartbeat (default 15 000 ms): `: heartbeat\n\n` — invisible to EventSource listeners, prevents proxy timeouts.

Pass `heartbeatMs: 0` to disable heartbeats (useful in unit tests).

```ts
import { EventBus, SseStream } from '@studnicky/dagonizer/progress';

const bus = new EventBus();
const stream = SseStream.of(bus, ['runs', 'errors'], { heartbeatMs: 15_000 });

// In a fetch handler:
return new Response(stream.readable, {
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
});
```

The stream closes cleanly when the consumer cancels (client disconnects). Cancellation unsubscribes all bus listeners and clears the heartbeat timer — no leak.

### Part 3 — ObservingDispatcher: hooks to bus to multiple consumers

`Dagonizer` lifecycle hooks fire synchronously inside `execute()`. The `ObservingDispatcher` subclass publishes a typed payload to an injected `EventBus` topic on every hook. Any number of downstream consumers subscribe independently — the hook body stays minimal and each consumer is decoupled from the others.

```ts
class ObservingDispatcher extends Dagonizer<MyState> {
  readonly #bus: EventBus;
  constructor(bus: EventBus) { super(); this.#bus = bus; }

  protected override onNodeStart(nodeName: string, _state: MyState, path: readonly string[]): void {
    this.#bus.publish('lifecycle', { event: 'nodeStart', nodeName, path: path.join('/') });
  }
  // ... onFlowStart, onFlowEnd, onNodeEnd, onError
}

const bus = new EventBus();

// Consumer A: console logger
bus.subscribe('lifecycle', (e) => console.log(e.payload));

// Consumer B: metrics counter
const metrics = { nodes: 0 };
bus.subscribe('lifecycle', (e) => {
  if ((e.payload as { event: string }).event === 'nodeStart') metrics.nodes++;
});

const dispatcher = new ObservingDispatcher(bus);
// register nodes + DAG ...
await dispatcher.execute('my-dag', state);
bus.dispose();
```

This pattern replaces the need to write a `ComposedDispatcher` with multiple log calls inside each hook override. Instead:

1. One hook override publishes one structured event.
2. Each consumer subscribes and reacts independently.
3. Adding a new consumer does not require touching the dispatcher.

## API

| Symbol | Import | Role |
|--------|--------|------|
| `EventBus` | `@studnicky/dagonizer/progress` | Topic-keyed pub/sub bus |
| `EventBusInterface` | `@studnicky/dagonizer/progress` | Class-shape type for `EventBus` |
| `BusListenerType<TPayload>` | `@studnicky/dagonizer/progress` | Callback type for `EventBus.subscribe` |
| `BusUnsubscribeType` | `@studnicky/dagonizer/progress` | Return type of `EventBus.subscribe` |
| `BusEventEnvelopeType<TPayload>` | `@studnicky/dagonizer/progress` | Typed envelope: `topic`, `payload`, `timestamp` |
| `BusEventEnvelopeWireType` | `@studnicky/dagonizer/progress` | Schema-derived wire type (`payload: unknown`) |
| `BusEventEnvelopeSchema` | `@studnicky/dagonizer/progress` | JSON Schema 2020-12 for validation |
| `BusEventEnvelope` | `@studnicky/dagonizer/progress` | Static factory: `.create(topic, payload, options?)` |
| `SseStream` | `@studnicky/dagonizer/progress` | Bus topic → SSE `ReadableStream<string>` |
| `SseStreamOptionsType` | `@studnicky/dagonizer/progress` | Options for `SseStream.of` (heartbeatMs) |

## Run

```bash
npx tsx examples/30-progress.ts
```
