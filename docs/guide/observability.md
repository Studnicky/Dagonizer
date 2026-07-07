---
title: 'Observability'
description: 'Subclass Dagonizer and override protected on* hooks to observe every execution boundary. Wire hooks to an EventBus for decoupled multi-subscriber observability.'
seeAlso:
  - text: 'Cancellation'
    link: './cancellation'
    description: '`onError` fires on abort and deadline-driven failures'
  - text: 'Subclassing State'
    link: './subclassing'
    description: 'a dispatcher subclass may also subclass state'
  - text: 'Dependency injection'
    link: './services'
    description: 'pass loggers or tracers via constructor injection'
  - text: 'Example 30: EventBus and SseStream'
    link: '../examples/30-progress'
    description: 'complete example: hooks → bus → console + SSE + metrics'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Observability

## What It Is

Observability is how a host application projects DAG execution into logs, traces, metrics, progress streams, and UI state without changing the DAG document. The graph remains business flow; observers watch execution boundaries.

You can subclass `Dagonizer` and override protected `on*` hooks, or attach `DispatcherObserverType` records through the `observers` option. Both surfaces observe flow, node, phase, and error boundaries.

## How It Works

Subclass `Dagonizer` and override protected `on*` hooks. The dispatcher calls those hooks around flow, phase, node, and error boundaries. Hook implementations can write to an event bus, tracer, logger, metrics sink, or browser state without changing the DAG document.

Protected `on*` hooks on `Dagonizer` fire at every execution boundary. Subclass the dispatcher and override whichever hooks you need. Class extension is the only extension mechanism; the dispatcher exposes no callback API.

## Diagrams, Examples, and Outputs

The Dispatcher demo is the compact runnable for observing routing, handoff, and operational control. The graph below is the same support dispatcher DAG rendered on the example pages:

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher observable DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

- [Cancellation](./cancellation) - `onError` fires on abort and deadline-driven failures
- [Subclassing State](./subclassing) - a dispatcher subclass may also subclass state
- [Dependency injection](./services) - pass loggers or tracers via constructor injection
- [Example 30: EventBus and SseStream](../examples/30-progress) - complete example: hooks → bus → console + SSE + metrics
- [Example 18: Observability](../examples/18-observability) - subclass and multi-observer examples

## What It Lets You Do

### Use when

Use observability hooks when a host needs traces, metrics, progress events, audit logs, or UI updates from a DAG run. The DAG should stay about business flow; observers project execution state into product and operations surfaces.

## Code Samples

The snippets below show the hook surface, subclass pattern, observer mux, EventBus publishing, SSE streaming, and timing integration.

### API surface

| Symbol | Source | Role |
|--------|--------|------|
| `Dagonizer.onFlowStart` | `@studnicky/dagonizer` | Fires after `state.markRunning()`, before the first node |
| `Dagonizer.onFlowEnd` | `@studnicky/dagonizer` | Fires after the last node (including aborted or failed paths) |
| `Dagonizer.onNodeStart` | `@studnicky/dagonizer` | Fires before each `node.execute()` |
| `Dagonizer.onNodeEnd` | `@studnicky/dagonizer` | Fires after each node resolves, before `yield` |
| `Dagonizer.onError` | `@studnicky/dagonizer` | Fires when a signal fires or a node throws |
| `Dagonizer.onPhaseEnter` | `@studnicky/dagonizer` | Fires before a `pre`/`post` phase placement runs |
| `Dagonizer.onPhaseExit` | `@studnicky/dagonizer` | Fires after a `pre`/`post` phase placement completes |

### Hook contracts

| Hook | When called | Arguments |
|------|-------------|-----------|
| `onFlowStart` | After `state.markRunning()`, before the first node | `dagName`, `state` |
| `onFlowEnd` | After the last node (including aborted or failed paths) | `dagName`, `state`, `result` |
| `onNodeStart` | Before `node.execute()` for each node entry | `nodeName`, `state`, `placementPath` |
| `onNodeEnd` | After each node resolves, before `yield` | `nodeName`, `output: string \| null`, `state`, `placementPath` |
| `onError` | When a signal fires or a node throws | `nodeName`, `error`, `state`, `placementPath` |
| `onPhaseEnter` | Before a `pre`/`post` phase placement runs | `dagName`, `phase`, `placementName`, `state`, `placementPath` |
| `onPhaseExit` | After a `pre`/`post` phase placement completes | `dagName`, `phase`, `placementName`, `state`, `placementPath` |

`onFlowEnd` is always called, even when the flow fails or is cancelled. `onError` may fire before `onFlowEnd` in the same execution.

For scatter and embedded-DAG nodes, `onNodeStart` and `onNodeEnd` fire once for the group entry (the containing `scatter` or `embedded-dag` placement), not once per constituent clone or inner node.

#### `placementPath`

`placementPath` is a required `readonly string[]` argument on `onNodeStart`, `onNodeEnd`, and `onError`. It is the ordered list of parent embedded-DAG placement names that led to the current node:

- Top-level node: `[]`
- Node inside an `EmbeddedDAGNode` placement named `on-topic-search`: `['on-topic-search']`
- Doubly-nested: `['on-topic-search', 'inner-placement']`

Use it to disambiguate same-named inner placements across multiple embedded-DAG instances. The full qualified id of the current node is `[...placementPath, nodeName].join('/')`.

## Details for Nerds

### Subclass hooks

<<< @/../examples/the-archivist/ObservedDag.ts#observed-dag

The Cartographer uses the same subclassing surface in a deterministic ETL
pipeline. Its dispatcher logs flow boundaries, node outputs, errors, phase
entries, phase exits, and embedded placement paths:

<<< @/../examples/the-cartographer/ObservedCartographer.ts#observed-cartographer

All seven default to no-ops. Override only the hooks you need. Multi-observer composition (logger plus tracer plus metrics) is a subclass concern: write it into the subclass body.

### Subclass observer

<<< @/../examples/18-observability.ts#subclass-observer

### OpenTelemetry integration

OpenTelemetry spans map directly onto the `onFlowStart` / `onFlowEnd` and `onNodeStart` / `onNodeEnd` pairs. The pattern is identical to the subclass observer above:

- `onFlowStart` → `tracer.startSpan('flow.<dagName>')`, stash in a `Map`.
- `onNodeStart` → `tracer.startSpan('node.<nodeName>')`, stash keyed by node name.
- `onNodeEnd` → retrieve the span, call `span.setAttribute('output', ...)`, then `span.end()`.
- `onError` → retrieve the span, call `span.recordException(error)` and `span.setStatus({ code: SpanStatusCode.ERROR })`.
- `onFlowEnd` → end the flow span and clear the map.

Wire `@opentelemetry/api` in through the constructor as a `Tracer` instance. The subclass holds the `Map<string, Span>` as a private field; nothing leaks to Dagonizer's public surface.

### `observers` option: mux without subclassing

Per-turn-rebuilt dispatchers (serverless handlers, per-request factories) cannot use subclassing because the dispatcher is constructed fresh each turn. The `observers` option accepts a `ReadonlyArray<DispatcherObserverType>` — each record's callbacks are muxed into the corresponding lifecycle hook in array order, after any subclass override.

```ts
import { Dagonizer } from '@studnicky/dagonizer';
import type { DispatcherObserverType } from '@studnicky/dagonizer';

const logObserver: DispatcherObserverType = {
  onFlowStart: (dagName) => console.log('[flow] start', dagName),
  onFlowEnd:   (dagName, _, res) => console.log('[flow] end', dagName, res.terminalOutcome),
  onNodeEnd:   (name, output) => console.log('[node]', name, '->', output),
};

const metrics = { nodeStart: 0, nodeEnd: 0 };
const metricsObserver: DispatcherObserverType = {
  onNodeStart: () => { metrics.nodeStart++; },
  onNodeEnd:   () => { metrics.nodeEnd++; },
};

const dispatcher = new Dagonizer<MyState>({
  observers: [logObserver, metricsObserver],
});
```

The `DispatcherObserverType` record mirrors the seven protected hooks. Every callback is optional — include only the hooks you need. Observers fire after the subclass override (if any), so both mechanisms are composable: a subclass can still call `super.onFlowStart(...)` and the muxed observers fire after it.

See also the full example: `npx tsx examples/33-plugin.ts` (the `#observers-option` region).

### Multi-observer composition

When one caller owns the dispatcher, the subclass pattern is sufficient. For multiple observers (logger plus tracer plus metrics), accept each as a constructor parameter and dispatch to all inside the relevant hook overrides:

<<< @/../examples/18-observability.ts#multi-observer

### EventBus: decoupled multi-subscriber observability

The subclass pattern works when one caller owns the dispatcher. When multiple orthogonal subscribers need to observe the same run — a console logger, an SSE endpoint, and a metrics counter — the `EventBus` from `@studnicky/dagonizer/progress` decouples the hook implementation from each subscriber.

Instead of dispatching to every observer inside each hook body, the subclass publishes one structured event per hook, and each observer subscribes independently. Adding a new observer does not require touching the dispatcher.

```ts
import { Dagonizer } from '@studnicky/dagonizer';
import { EventBus } from '@studnicky/dagonizer/progress';
import type { BusEventEnvelopeType } from '@studnicky/dagonizer/progress';

type LifecyclePayloadType =
  | { event: 'flowStart'; dagName: string }
  | { event: 'flowEnd';   dagName: string; outcome: string }
  | { event: 'nodeStart'; nodeName: string; path: string }
  | { event: 'nodeEnd';   nodeName: string; output: string | null; path: string }
  | { event: 'nodeError'; nodeName: string; message: string };

class ObservingDispatcher extends Dagonizer<MyState> {
  readonly #bus: EventBus;
  readonly #topic: string;

  constructor(bus: EventBus, topic: string) {
    super();
    this.#bus = bus;
    this.#topic = topic;
  }

  protected override onFlowStart(dagName: string): void {
    this.#bus.publish(this.#topic, { event: 'flowStart', dagName });
  }

  protected override onFlowEnd(dagName: string, _state: MyState, result): void {
    const outcome = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none';
    this.#bus.publish(this.#topic, { event: 'flowEnd', dagName, outcome });
  }

  protected override onNodeStart(nodeName: string, _state: MyState, path: readonly string[]): void {
    this.#bus.publish(this.#topic, { event: 'nodeStart', nodeName, path: path.join('/') });
  }

  protected override onNodeEnd(nodeName: string, output: string | null, _state: MyState, path: readonly string[]): void {
    this.#bus.publish(this.#topic, { event: 'nodeEnd', nodeName, output, path: path.join('/') });
  }

  protected override onError(nodeName: string, error: Error, _state: MyState, path: readonly string[]): void {
    this.#bus.publish(this.#topic, { event: 'nodeError', nodeName, message: error.message });
  }
}
```

Wire subscribers before executing:

```ts
const bus = new EventBus();

// Subscriber A: console logger
bus.subscribe('lifecycle', (e: BusEventEnvelopeType) => {
  const p = e.payload as LifecyclePayloadType;
  console.log(`[log] ${p.event}`);
});

// Subscriber B: metrics counter
const metrics = { nodeStart: 0, nodeEnd: 0 };
bus.subscribe('lifecycle', (e: BusEventEnvelopeType) => {
  const p = e.payload as LifecyclePayloadType;
  if (p.event === 'nodeStart') metrics.nodeStart++;
  if (p.event === 'nodeEnd')   metrics.nodeEnd++;
});

// Subscriber C: SSE endpoint (ReadableStream piped as response body)
import { SseStream } from '@studnicky/dagonizer/progress';
const stream = SseStream.of(bus, ['lifecycle'], { heartbeatMs: 15_000 });
// return new Response(stream.readable, { headers: { 'Content-Type': 'text/event-stream' } });

const dispatcher = new ObservingDispatcher(bus, 'lifecycle');
// register nodes + DAG ...
await dispatcher.execute('my-dag', state);

bus.dispose(); // unsubscribes all subscribers
```

**EventBus delivery is synchronous.** Every subscriber fires inline before `publish` returns, in subscription order. A throwing subscriber is caught and ignored so that sibling subscribers still receive the event.

**SseStream heartbeats.** The default heartbeat interval is 15 000 ms (a `: heartbeat\n\n` SSE comment frame, invisible to `EventSource` listeners). Set `heartbeatMs: 0` to disable in tests. The heartbeat timer is cleared when the subscriber cancels the stream.

See [Example 30: EventBus and SseStream](../examples/30-progress) for a complete runnable demonstration.

### BusObserver

`BusObserver` is a pre-built `DispatcherObserverType` implementation that publishes each lifecycle event as a typed `DagLifecycleEventType` payload to a named bus topic. Pass it in the `observers` option instead of writing the publishing subclass yourself.

```ts
import { Dagonizer } from '@studnicky/dagonizer';
import { EventBus, BusObserver, SseStream } from '@studnicky/dagonizer/progress';
import type { DagLifecycleEventType } from '@studnicky/dagonizer/progress';

const bus = new EventBus();
const dispatcher = new Dagonizer<MyState>({
  observers: [new BusObserver(bus, 'pipeline-events')],
});

// Multiple independent subscribers on the same topic
bus.subscribe('pipeline-events', (e) => {
  const p = e.payload as DagLifecycleEventType;
  logger.info(p.event);
});
bus.subscribe('pipeline-events', (e) => {
  const p = e.payload as DagLifecycleEventType;
  metrics.record(p);
});

// SSE stream for browser clients
const stream = SseStream.of(bus, ['pipeline-events'], { heartbeatMs: 15_000 });
// return new Response(stream.readable, { headers: { 'Content-Type': 'text/event-stream' } });

// register nodes + DAG, then run:
await dispatcher.execute('my-dag', new MyState());
bus.dispose();
```

#### `DagLifecycleEventType`

A discriminated union where the `event` field is the discriminant:

| `event` | Additional fields |
|---------|-------------------|
| `'flowStart'` | `dagName` |
| `'flowEnd'` | `dagName`, `outcome` |
| `'nodeStart'` | `nodeName`, `placementPath` |
| `'nodeEnd'` | `nodeName`, `output`, `placementPath` |
| `'nodeError'` | `nodeName`, `error`, `placementPath` |
| `'phaseEnter'` | `dagName`, `phase`, `placementName` |
| `'phaseExit'` | `dagName`, `phase`, `placementName` |

State is never included in the payload. State is a mutable reference; publishing it to multiple independent subscribers would allow one subscriber's read to race another subscriber's write.

`outcome` on `'flowEnd'` is `result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none'`.

#### Combining BusObserver with subclassing

`BusObserver` is composable with subclass hooks. If you also need the `ObservedDag` console logger, pass both:

```ts
const dispatcher = new ObservedDag<MyState>(logger, {
  observers: [new BusObserver(bus, 'pipeline-events')],
});
```

The subclass hook fires first, then the observer array fires in order. No changes to either the subclass or `BusObserver` are needed.

#### Timing

`ObservedDag` accepts an optional substrate `Timing` sink:

```ts
import { Timing } from '@studnicky/timing';

const timing = Timing.create({ maxEvents: 100 });
const dispatcher = new ObservedDag<MyState>(logger, {
  timing,
  observers: [new BusObserver(bus, 'pipeline-events')],
});
```

The observer records `dag.flow.start`, `dag.flow.complete`, `dag.node.start`, `dag.node.complete`, `dag.node.error`, `dag.phase.start`, and `dag.phase.complete`. Read `timing.getEvents()` when emitting the final request or trace log context.

## Related Concepts

- [Cancellation](./cancellation) - `onError` fires on abort and deadline-driven failures
- [Subclassing State](./subclassing) - a dispatcher subclass may also subclass state
- [Dependency injection](./services) - pass loggers or tracers via constructor injection
- [Example 30: EventBus and SseStream](../examples/30-progress) - complete example: hooks → bus → console + SSE + metrics
- [Example 18: Observability](../examples/18-observability)
- [Reference: Dagonizer](../reference/dagonizer)
- [Reference: Contracts](../reference/contracts)
- [Reference: Lifecycle](../reference/lifecycle)
