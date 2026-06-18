/**
 * loopback-channel.test.ts
 *
 * LoopbackChannel transport + ChannelDispatch correlation over the channel.
 *
 * Coverage targets:
 *   S4 — LoopbackChannel messages sent before onMessage() is registered are
 *        silently dropped (no error, no delayed delivery after registration).
 *   G7 — close() severs both directions; messages sent after close are silently
 *        dropped on the closed side and on the peer side.
 *
 * ChannelDispatch correlation (the single-subscription guard over a channel):
 *   (a) Exactly ONE underlying channel.onMessage subscription is installed
 *       regardless of request count — measured via a counting wrapper channel.
 *   (b) Results correlate correctly — each of N sequential requests gets its own
 *       outcome, never a cross-contaminated one.
 *   (c) No cross-talk — every response is delivered to the caller that sent the
 *       matching correlationId, even when the host replies out of order.
 *   Worker observability — a node event forwarded from the worker/host side
 *       reaches the parent dispatcher's observer relay with the composite
 *       placementPath.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { DagContainerOptions, PoolEntry } from '../../src/container/DagContainerBase.js';
import type { DagOutcomeInterface } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { ObserverRelay } from '../../src/Dagonizer.js';
import type { BridgeMessage } from '../../src/entities/executor/BridgeMessage.js';
import type { ExecutionRequest } from '../../src/entities/executor/ExecutionRequest.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

const INIT_MSG: BridgeMessage = {
  'kind': 'init',
  'registryModule': '/test/module.js',
  'registryVersion': '1.0.0',
  'servicesConfig': {},
};

const SHUTDOWN_MSG: BridgeMessage = { 'kind': 'shutdown' };

// ---------------------------------------------------------------------------
// S4 — pre-registration drop
// ---------------------------------------------------------------------------

void describe('LoopbackChannel — pre-registration drop (S4)', () => {
  void it('message sent before onMessage() is registered is silently dropped', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    // Send BEFORE registering a handler on hostSide.
    parentSide.send(INIT_MSG);

    // Wait a tick to let setImmediate fire (if it were going to).
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Now register handler — it must NOT fire for the already-sent message.
    const received: BridgeMessage[] = [];
    hostSide.onMessage((msg: BridgeMessage) => received.push(msg));

    // Another tick — still no delivery.
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(received.length, 0,
      'message sent before onMessage() registration must be silently dropped');
  });

  void it('after onMessage() is registered, subsequent messages are delivered', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const received: BridgeMessage[] = [];
    hostSide.onMessage((msg: BridgeMessage) => received.push(msg));

    parentSide.send(INIT_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'init');
  });
});

// ---------------------------------------------------------------------------
// G7 — close() severs both directions
// ---------------------------------------------------------------------------

void describe('LoopbackChannel — close() severs both directions (G7)', () => {
  void it('send after close() on the sender side is silently dropped', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const received: BridgeMessage[] = [];
    hostSide.onMessage((msg: BridgeMessage) => received.push(msg));

    // Verify delivery works before close.
    parentSide.send(INIT_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.strictEqual(received.length, 1, 'message before close must arrive');

    // Close parentSide.
    parentSide.close();

    // Send after close — must be dropped silently.
    parentSide.send(SHUTDOWN_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(received.length, 1, 'message after sender close must be dropped');
  });

  void it('send to the closed side is silently dropped', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const received: BridgeMessage[] = [];
    parentSide.onMessage((msg: BridgeMessage) => received.push(msg));

    // Close hostSide — receiving side closed.
    hostSide.close();

    // parentSide sends to hostSide — but hostSide is closed, so hostSide's peer
    // (parentSide itself) won't deliver because parentSide's peer (hostSide) is closed.
    // Actually: parentSide.send → delivers to hostSide.handler — but hostSide is closed,
    // so its peer reference is null. parentSide.send checks peer.closed first.
    // Let's verify: close() on hostSide should not affect parentSide.send path either.
    hostSide.send(SHUTDOWN_MSG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // After hostSide.close(), its peer (parentSide) should still be reachable
    // for messages from parentSide → hostSide, but hostSide → parentSide
    // sends are dropped because peer reference is severed on close().
    assert.strictEqual(received.length, 0,
      'messages from the closed side must not arrive');
  });

  void it('close() is idempotent — calling twice does not throw', () => {
    const [parentSide] = LoopbackChannel.pair();
    assert.doesNotThrow(() => {
      parentSide.close();
      parentSide.close();
    });
  });

  void it('channel pair is bidirectional before close', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    const parentReceived: BridgeMessage[] = [];
    const hostReceived: BridgeMessage[] = [];
    parentSide.onMessage((msg: BridgeMessage) => parentReceived.push(msg));
    hostSide.onMessage((msg: BridgeMessage) => hostReceived.push(msg));

    parentSide.send(INIT_MSG);
    hostSide.send(SHUTDOWN_MSG);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.strictEqual(hostReceived.length, 1, 'parent→host must deliver');
    assert.strictEqual(hostReceived[0]?.kind, 'init');
    assert.strictEqual(parentReceived.length, 1, 'host→parent must deliver');
    assert.strictEqual(parentReceived[0]?.kind, 'shutdown');
  });
});

// ---------------------------------------------------------------------------
// CountingChannel: wraps a MessageChannelInterface and counts onMessage calls
// ---------------------------------------------------------------------------

class CountingChannel implements MessageChannelInterface {
  readonly #inner: MessageChannelInterface;
  #onMessageCallCount: number;

  constructor(inner: MessageChannelInterface) {
    this.#inner = inner;
    this.#onMessageCallCount = 0;
  }

  get onMessageCallCount(): number {
    return this.#onMessageCallCount;
  }

  send(message: BridgeMessage): void {
    this.#inner.send(message);
  }

  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#onMessageCallCount += 1;
    this.#inner.onMessage(handler);
  }

  close(): void {
    this.#inner.close();
  }
}

// ---------------------------------------------------------------------------
// MinimalState: simplest possible NodeStateBase for the correlation test
// ---------------------------------------------------------------------------

class MinimalState extends NodeStateBase {}

// ---------------------------------------------------------------------------
// MinimalDagTask: minimal DagTaskInterface implementation
// ---------------------------------------------------------------------------

function makeTask(correlationId: string, signal: AbortSignal): DagTaskInterface<MinimalState, undefined> {
  const request: ExecutionRequest = {
    'dagName': 'test-dag',
    'placementPath': [],
    'items': [{ 'id': correlationId, 'snapshot': {} as { [key: string]: unknown } }],
    'timeoutMs': null,
    'correlationId': correlationId,
  };
  return {
    'dagName': 'test-dag',
    'placementPath': [],
    'correlationId': correlationId,
    'timeout': Timeout.none(),
    'state': new MinimalState(),
    'context': {
      'dagName': 'test-dag',
      'nodeName': 'test-node',
      'signal': signal,
      'services': undefined,
    } as NodeContextInterface<undefined>,
    toRequest(): ExecutionRequest {
      return request;
    },
  };
}

// ---------------------------------------------------------------------------
// SingleChannelContainer: DagContainerBase that always routes through a single
// pre-built channel. Both sequential and concurrent requests use the same
// channel so ChannelDispatch's correlationId-demux is exercised directly.
//
// The pool seams are no-ops — the base pool is never used because acquireChannel
// and releaseChannel are overridden to bypass it. This tests ChannelDispatch
// concurrency invariants, not pool growth.
// ---------------------------------------------------------------------------

const NOOP_INIT: DagContainerOptions['init'] = {
  'registryModule': 'test',
  'registryVersion': '0.0.0',
  'servicesConfig': {},
};

class SingleChannelContainer extends DagContainerBase<MinimalState, null> {
  readonly #channel: MessageChannelInterface;

  constructor(channel: MessageChannelInterface, _options: Partial<DagContainerOptions> = {}) {
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': 1,
      'init': NOOP_INIT,
    });
    this.#channel = channel;
  }

  // Override acquireChannel to bypass the pool and always return the same channel.
  protected override acquireChannel(): Promise<MessageChannelInterface> {
    return Promise.resolve(this.#channel);
  }

  // Override releaseChannel: no-op — the channel is never pooled.
  protected override releaseChannel(_channel: MessageChannelInterface): void { /* bypass pool */ }

  protected override createEntry(): PoolEntry<null> {
    return { 'worker': null, 'channel': this.#channel, 'initialized': true };
  }

  protected override attachDeathListeners(_entry: PoolEntry<null>): void {
    // Test channel — no death events.
  }

  protected override terminateWorker(_worker: null): void {
    // No worker to terminate.
  }

  protected override awaitWorkerExit(_worker: null): Promise<void> {
    return new Promise(() => { /* never resolves — no real worker exit */ });
  }
}

// ---------------------------------------------------------------------------
// FakeHost: drives the host side of the LoopbackChannel.
//
// Receives 'init' → sends 'ready'.
// Receives 'execute' → sends 'result' with the matching correlationId and
//   terminalOutput = 'done-' + correlationId (deterministic per-request value).
// ---------------------------------------------------------------------------

function startFakeHost(hostSide: MessageChannelInterface): void {
  hostSide.onMessage((msg) => {
    if (msg.kind === 'init') {
      hostSide.send({
        'kind': 'ready',
        'registryVersion': msg.registryVersion,
        'capabilities': [],
      });
    } else if (msg.kind === 'execute') {
      const { correlationId } = msg.request;
      const itemId = msg.request.items[0]?.id ?? correlationId;
      hostSide.send({
        'kind': 'result',
        'response': {
          'correlationId': correlationId,
          'items': [{ 'id': itemId, 'snapshot': null, 'terminalOutcome': `done-${correlationId}` }],
          'errors': [],
          'intermediates': [],
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// ChannelDispatch correlation: single subscription + correlationId demux
// ---------------------------------------------------------------------------

void describe('channel-correlation: single subscription + correlationId demux', () => {

  void it('(a) exactly ONE underlying onMessage subscription regardless of request count', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const counting = new CountingChannel(parentSide);
    startFakeHost(hostSide);

    const container = new SingleChannelContainer(counting);

    // ChannelDispatch is constructed on the first #dispatchFor() call inside
    // runDag, which calls channel.onMessage() exactly once. Driving 30 requests
    // and then checking the count proves the subscription is installed once.
    const REQUEST_COUNT = 30;
    const ac = new AbortController();
    const results: DagOutcomeInterface[] = [];

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const task = makeTask(`req-${i}`, ac.signal);
      const outcome = await container.runDag(task);
      results.push(outcome);
    }

    // (a) Core assertion: exactly one onMessage call regardless of request count.
    assert.strictEqual(
      counting.onMessageCallCount,
      1,
      `Expected exactly 1 onMessage subscription; got ${counting.onMessageCallCount}`,
    );
    // Every request resolved to an outcome.
    assert.strictEqual(results.length, REQUEST_COUNT);
  });

  void it('(b) results correlate correctly — each request gets its own outcome', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    startFakeHost(hostSide);

    const container = new SingleChannelContainer(parentSide);

    const REQUEST_COUNT = 30;
    const ac = new AbortController();

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const correlationId = `req-${i}`;
      const task = makeTask(correlationId, ac.signal);
      const outcome = await container.runDag(task);

      // (b) Each request must receive its own correlated terminalOutput.
      assert.strictEqual(
        outcome.terminalOutput,
        `done-${correlationId}`,
        `Request ${correlationId}: expected terminalOutput 'done-${correlationId}', got '${outcome.terminalOutput}'`,
      );
    }
  });

  void it('(c) no cross-talk — correlationId routing delivers to the correct caller', async () => {
    // Drive two overlapping requests concurrently on the same channel.
    // The FakeHost delays the first response until after the second execute
    // is sent, verifying that each caller receives exactly its own response.

    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    // Custom host: collect execute messages and respond in reverse order
    // to prove correlationId routing (not FIFO) assigns responses correctly.
    const pending: Array<{ correlationId: string }> = [];
    hostSide.onMessage((msg: BridgeMessage) => {
      if (msg.kind === 'init') {
        hostSide.send({
          'kind': 'ready',
          'registryVersion': msg.registryVersion,
          'capabilities': [],
        });
      } else if (msg.kind === 'execute') {
        pending.push({ 'correlationId': msg.request.correlationId });
        // After collecting two requests, respond in REVERSE order.
        if (pending.length === 2) {
          const secondId = pending[1]?.correlationId ?? '';
          const firstId = pending[0]?.correlationId ?? '';
          // Respond to second first, then first.
          setImmediate(() => {
            hostSide.send({
              'kind': 'result',
              'response': {
                'correlationId': secondId,
                'items': [{ 'id': secondId, 'snapshot': null, 'terminalOutcome': `done-${secondId}` }],
                'errors': [],
                'intermediates': [],
              },
            });
            setImmediate(() => {
              hostSide.send({
                'kind': 'result',
                'response': {
                  'correlationId': firstId,
                  'items': [{ 'id': firstId, 'snapshot': null, 'terminalOutcome': `done-${firstId}` }],
                  'errors': [],
                  'intermediates': [],
                },
              });
            });
          });
        }
      }
    });

    const ac = new AbortController();
    // Launch both requests concurrently.
    const [outcomeA, outcomeB] = await Promise.all([
      container.runDag(makeTask('req-A', ac.signal)),
      container.runDag(makeTask('req-B', ac.signal)),
    ]);

    // (c) Each caller must receive its own outcome despite out-of-order delivery.
    assert.strictEqual(outcomeA.terminalOutput, 'done-req-A',
      `req-A: expected 'done-req-A', got '${outcomeA.terminalOutput}'`);
    assert.strictEqual(outcomeB.terminalOutput, 'done-req-B',
      `req-B: expected 'done-req-B', got '${outcomeB.terminalOutput}'`);
  });

});

// ---------------------------------------------------------------------------
// Worker observability: a node event forwarded from the worker/host side must
// reach the PARENT dispatcher's observer relay (which the parent binds to its
// own subclass hooks). This proves child/worker DAG nodes are observable via
// the single canonical surface — `onNodeStart`/`onNodeEnd`/… on the subclass.
// ---------------------------------------------------------------------------

void describe('worker observability: forwarded node events reach the parent observer relay', () => {

  void it('a worker-side nodeStart message invokes relay.onNodeStart with the composite placementPath', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();

    // FakeHost: on execute, forward an inner node-start (exactly as DagHost's
    // WorkerObserver does for a contained sub-DAG), then complete the request.
    hostSide.onMessage((msg: BridgeMessage) => {
      if (msg.kind === 'init') {
        hostSide.send({ 'kind': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [] });
      } else if (msg.kind === 'execute') {
        const { correlationId } = msg.request;
        hostSide.send({
          'kind': 'instrumentation',
          'correlationId': correlationId,
          'hook': 'nodeStart',
          'phase': '',
          'dagName': 'inner-dag',
          'nodeName': 'inner-step',
          'output': null,
          'message': '',
          'placementPath': ['scatter-placement', 'inner-step'],
        });
        hostSide.send({
          'kind': 'result',
          'response': {
            'correlationId': correlationId,
            'items': [{ 'id': correlationId, 'snapshot': null, 'terminalOutcome': 'done' }],
            'errors': [],
            'intermediates': [],
          },
        });
      }
    });

    const container = new SingleChannelContainer(parentSide);

    // The parent dispatcher binds its protected subclass hooks to a relay of
    // exactly this shape (Dagonizer.buildObserverRelay); a recording stand-in
    // proves the forwarded event lands on that surface.
    const seen: Array<{ readonly node: string; readonly path: readonly string[] }> = [];
    const relay: ObserverRelay = {
      onNodeStart(node, path) { seen.push({ 'node': node, 'path': path }); },
      onNodeEnd() { /* unused in this test */ },
      onError() { /* unused in this test */ },
      onPhaseEnter() { /* unused in this test */ },
      onPhaseExit() { /* unused in this test */ },
      onContractWarning() { /* unused in this test */ },
    };

    const ac = new AbortController();
    const outcome = await container.runDag(makeTask('obs-1', ac.signal), { relay });

    assert.strictEqual(outcome.terminalOutput, 'done');
    assert.strictEqual(seen.length, 1, 'parent relay observes exactly one forwarded inner node');
    assert.strictEqual(seen[0]?.node, 'inner-step');
    assert.deepStrictEqual(seen[0]?.path, ['scatter-placement', 'inner-step']);
  });

});
