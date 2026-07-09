/**
 * 30-progress: EventBus, SseStream, and ObservedDag lifecycle integration.
 *
 * Demonstrates the three layers of the progress substrate:
 *
 *   1. EventBus — in-process, topic-keyed pub/sub. Publish and subscribe
 *      to typed events with automatic cleanup. Delivery goes through a
 *      per-subscriber queue, so `publish()` returns a `Promise<void>` that
 *      resolves once every subscriber queue has accepted the event.
 *
 *   2. SseStream — turn any EventBus topic subscription into a
 *      ReadableStream of Server-Sent Events frames. Heartbeats are
 *      disabled in this example (heartbeatMs: 0) so the output is
 *      deterministic; in a real server pass heartbeatMs: 15_000.
 *
 *   3. ObservingDispatcher — a Dagonizer subclass that publishes every
 *      lifecycle event (onFlowStart, onNodeStart, onNodeEnd, onFlowEnd,
 *      onError) to an injected EventBus. Multiple downstream consumers
 *      (console logger, SSE stream, metrics counter) subscribe to the
 *      bus — none of them require a hook override or subclass of their own.
 *
 * The DAG definition lives in examples/dags/30-progress.ts so the module
 * is side-effect-free and importable without triggering execution.
 *
 * Import: @studnicky/dagonizer/progress
 *
 * Run: npx tsx examples/30-progress.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import type { ExecutionResultType } from '@studnicky/dagonizer';
import {
  EventBus,
  SseStream,
} from '@studnicky/dagonizer/progress';
import type {
  BusEventEnvelopeType,
} from '@studnicky/dagonizer/progress';
import { ProgressState, FetchNode, EnrichNode, dag, dagIri } from './dags/30-progress.js';

// ---------------------------------------------------------------------------
// Part 1: EventBus — subscribe, publish, unsubscribe
// ---------------------------------------------------------------------------

process.stdout.write('\n30-progress: EventBus and SseStream integration\n');
process.stdout.write('='.repeat(52) + '\n\n');
process.stdout.write('--- Part 1: EventBus publish/subscribe ---\n\n');

const bus = EventBus.of();

// Subscribe with an unsubscribe handle.
const received: string[] = [];
const unsub = bus.subscribe('demo', (event: BusEventEnvelopeType) => {
  received.push(String(event.payload));
});

await bus.publish('demo', 'first');
await bus.publish('demo', 'second');

// Unsubscribe — subsequent publishes are not delivered.
unsub();
await bus.publish('demo', 'after-unsub');

process.stdout.write(`  Received ${String(received.length)} events: [${received.join(', ')}]\n`);
process.stdout.write('  After unsub: 0 additional events delivered.\n\n');

// ---------------------------------------------------------------------------
// Part 2: SseStream — bus topic → SSE ReadableStream
// ---------------------------------------------------------------------------

process.stdout.write('--- Part 2: SseStream — bus topic to SSE frames ---\n\n');

const sseBus = EventBus.of();
// heartbeatMs: 0 disables the heartbeat timer for deterministic output.
const sseStream = SseStream.of(sseBus, ['runs'], { 'heartbeatMs': 0 });

// Pull chunks from the stream using the web-standard Reader API.
class StreamReader {
  private constructor() { /* static class */ }

  static async take(stream: ReadableStream<string>, count: number): Promise<string[]> {
    const chunks: string[] = [];
    const reader = stream.getReader();
    try {
      while (chunks.length < count) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined) chunks.push(value);
      }
    } finally {
      reader.cancel();
      reader.releaseLock();
    }
    return chunks;
  }
}

// Publish two events and collect the connected frame + two data frames.
await sseBus.publish('runs', { 'nodeId': 'fetch', 'event': 'start' });
await sseBus.publish('runs', { 'nodeId': 'enrich', 'event': 'start' });

const frames = await StreamReader.take(sseStream.readable, 3);

for (const frame of frames) {
  process.stdout.write(`  frame: ${frame.trim()}\n`);
}
process.stdout.write('\n');

await sseBus.close();

// ---------------------------------------------------------------------------
// Part 3: ObservingDispatcher — lifecycle hooks → EventBus → multiple sinks
// ---------------------------------------------------------------------------

process.stdout.write('--- Part 3: ObservingDispatcher — hooks wired to EventBus ---\n\n');

// Event payload shapes published by ObservingDispatcher.
type FlowStartPayloadType = { 'event': 'flowStart'; 'dagName': string };
type FlowEndPayloadType   = { 'event': 'flowEnd';   'dagName': string; 'outcome': string };
type NodeStartPayloadType = { 'event': 'nodeStart';  'nodeName': string; 'path': string };
type NodeEndPayloadType   = { 'event': 'nodeEnd';    'nodeName': string; 'output': string | null; 'path': string };
type NodeErrorPayloadType = { 'event': 'nodeError';  'nodeName': string; 'message': string };

type LifecyclePayloadType =
  | FlowStartPayloadType
  | FlowEndPayloadType
  | NodeStartPayloadType
  | NodeEndPayloadType
  | NodeErrorPayloadType;

class LifecyclePayload {
  static is(value: unknown): value is LifecyclePayloadType {
    return (
      typeof value === 'object' &&
      value !== null &&
      'event' in value &&
      (
        (value as { 'event': unknown })['event'] === 'flowStart' ||
        (value as { 'event': unknown })['event'] === 'flowEnd' ||
        (value as { 'event': unknown })['event'] === 'nodeStart' ||
        (value as { 'event': unknown })['event'] === 'nodeEnd' ||
        (value as { 'event': unknown })['event'] === 'nodeError'
      )
    );
  }
}

// ObservingDispatcher: publishes every lifecycle event to an injected bus.
// Consumers subscribe to the bus topic independently — no multiplexing
// in the hook implementation itself.
class ObservingDispatcher extends Dagonizer<ProgressState> {
  readonly #bus: EventBus;
  readonly #topic: string;

  constructor(bus: EventBus, topic: string) {
    super();
    this.#bus = bus;
    this.#topic = topic;
  }

  protected override onFlowStart(dagName: string): void {
    const payload: FlowStartPayloadType = { 'event': 'flowStart', 'dagName': dagName };
    void this.#bus.publish(this.#topic, payload);
  }

  protected override onFlowEnd(
    dagName: string,
    _state: ProgressState,
    result: ExecutionResultType<ProgressState>,
  ): void {
    const outcome = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none';
    const payload: FlowEndPayloadType = { 'event': 'flowEnd', 'dagName': dagName, 'outcome': outcome };
    void this.#bus.publish(this.#topic, payload);
  }

  protected override onNodeStart(
    nodeName: string,
    _state: ProgressState,
    placementPath: readonly string[],
  ): void {
    const payload: NodeStartPayloadType = {
      'event': 'nodeStart',
      'nodeName': nodeName,
      'path': placementPath.join('/'),
    };
    void this.#bus.publish(this.#topic, payload);
  }

  protected override onNodeEnd(
    nodeName: string,
    output: string | null,
    _state: ProgressState,
    placementPath: readonly string[],
  ): void {
    const payload: NodeEndPayloadType = {
      'event': 'nodeEnd',
      'nodeName': nodeName,
      'output': output,
      'path': placementPath.join('/'),
    };
    void this.#bus.publish(this.#topic, payload);
  }

  protected override onError(
    nodeName: string,
    error: Error,
    _state: ProgressState,
    placementPath: readonly string[],
  ): void {
    const payload: NodeErrorPayloadType = {
      'event': 'nodeError',
      'nodeName': nodeName,
      'message': `[${placementPath.join('/')}] ${error.message}`,
    };
    void this.#bus.publish(this.#topic, payload);
  }
}

// Wire two independent consumers to the same bus topic:
//   consumer A: console log sink
//   consumer B: in-memory metrics counter

const lifecycleBus = EventBus.of();

// Consumer A: console log.
const logLines: string[] = [];
lifecycleBus.subscribe('lifecycle', (envelope: BusEventEnvelopeType) => {
  if (!LifecyclePayload.is(envelope.payload)) return;
  const p = envelope.payload;
  logLines.push(`[log] ${p.event}${'nodeName' in p ? ` node=${p.nodeName}` : ''}${'dagName' in p ? ` dag=${p.dagName}` : ''}`);
});

// Consumer B: metrics counter.
const metrics = { nodeStart: 0, nodeEnd: 0, flowStart: 0, flowEnd: 0, nodeError: 0 };
lifecycleBus.subscribe('lifecycle', (envelope: BusEventEnvelopeType) => {
  if (!LifecyclePayload.is(envelope.payload)) return;
  const p = envelope.payload;
  if (p.event === 'nodeStart') metrics.nodeStart++;
  else if (p.event === 'nodeEnd') metrics.nodeEnd++;
  else if (p.event === 'flowStart') metrics.flowStart++;
  else if (p.event === 'flowEnd') metrics.flowEnd++;
  else if (p.event === 'nodeError') metrics.nodeError++;
});

// Run the DAG through the observing dispatcher.
const dispatcher = new ObservingDispatcher(lifecycleBus, 'lifecycle');
dispatcher.registerNode(new FetchNode());
dispatcher.registerNode(new EnrichNode());
dispatcher.registerDAG(dag);

const state = new ProgressState();
const result = await dispatcher.execute(dagIri, state);

// Lifecycle hooks are synchronous overrides, so each publish() call is
// fire-and-forget (`void this.#bus.publish(...)`) rather than awaited.
// Drain the bus so every subscriber queue has finished delivery before
// reading the consumer-side accumulators below.
await lifecycleBus.drain();

process.stdout.write(`  DAG lifecycle: ${result.state.lifecycle.variant}\n`);
process.stdout.write(`  Enriched items: [${state.enriched.join(', ')}]\n\n`);

process.stdout.write('  Consumer A (log sink):\n');
for (const line of logLines) {
  process.stdout.write(`    ${line}\n`);
}

process.stdout.write('\n  Consumer B (metrics counter):\n');
process.stdout.write(`    flowStart=${String(metrics.flowStart)} flowEnd=${String(metrics.flowEnd)}\n`);
process.stdout.write(`    nodeStart=${String(metrics.nodeStart)} nodeEnd=${String(metrics.nodeEnd)} nodeError=${String(metrics.nodeError)}\n`);

await lifecycleBus.close();

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

await bus.close();

process.stdout.write('\n30-progress: done\n');
process.stdout.write('  EventBus: topic-keyed, in-process, per-subscriber queued delivery\n');
process.stdout.write('  SseStream: ReadableStream of SSE frames from a bus topic\n');
process.stdout.write('  ObservingDispatcher: lifecycle hooks → bus → many consumers\n');
