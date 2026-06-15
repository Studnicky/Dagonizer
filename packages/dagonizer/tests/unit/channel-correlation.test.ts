/**
 * channel-correlation.test.ts
 *
 * Regression guard for the EventEmitter listener-accumulation bug:
 *   Before fix: DagContainerBase.runDag called channel.onMessage(handler) on
 *   every request, accumulating O(N) listeners on a pooled worker channel.
 *   After fix: ChannelDispatch installs exactly ONE channel.onMessage handler
 *   for the channel's lifetime; correlationId routing demuxes all responses.
 *
 * What this test asserts:
 *   (a) Exactly ONE underlying subscription is installed regardless of request
 *       count — measured via a counting wrapper channel.
 *   (b) Results correlate correctly — each of N sequential requests gets its
 *       own outcome, never a cross-contaminated one.
 *   (c) No cross-talk — every response is delivered to the caller that sent
 *       the matching correlationId.
 *
 * The test drives 30 sequential runDag() calls through a single channel using
 * a minimal DagContainerBase subclass whose acquireChannel() always returns the
 * same channel instance (simulating a pooled worker reused many times).
 *
 * The CountingChannel wraps a LoopbackSide and records how many times
 * onMessage() is called — this is the "subscription count." With the fix,
 * it must be exactly 1 regardless of request count.
 *
 * A FakeHost drives the other side of the LoopbackChannel: it receives
 * 'execute' messages and echoes a 'result' message with the matching correlationId
 * and a deterministic terminalOutput derived from the request. This lets the
 * test verify that correlationId routing is correct.
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
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Timeout } from '../../src/runtime/Timeout.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

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
// MinimalState: simplest possible NodeStateBase for the test
// ---------------------------------------------------------------------------

class MinimalState extends NodeStateBase {}

// ---------------------------------------------------------------------------
// MinimalDagTask: minimal DagTaskInterface implementation
// ---------------------------------------------------------------------------

function makeTask(correlationId: string, signal: AbortSignal): DagTaskInterface<MinimalState, undefined> {
  const request: ExecutionRequest = {
    'dagName': 'test-dag',
    'placementPath': [],
    'stateSnapshot': {} as JsonObject,
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
      hostSide.send({
        'kind': 'result',
        'response': {
          'correlationId': correlationId,
          'terminalOutput': `done-${correlationId}`,
          'errors': [],
          'stateSnapshot': null,
          'intermediates': [],
        },
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('channel-correlation: single subscription + correlationId demux', () => {

  void it('(a) exactly ONE underlying onMessage subscription regardless of request count', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const counting = new CountingChannel(parentSide);
    startFakeHost(hostSide);

    const container = new SingleChannelContainer(counting);

    // Initialize the channel (sends init, receives ready).
    // initializeChannel is protected — exercise via the first runDag which
    // internally creates the ChannelDispatch (calling onMessage once) and
    // then does a request. We call initializeChannel indirectly through the
    // protected helper exposed to subclasses: call it directly via the
    // container's own initializeChannel path — which is exactly what real
    // backend subclasses do before their first acquire.
    //
    // The simplest approach: run 30 requests and then check the count.
    // ChannelDispatch is constructed on the first #dispatchFor() call inside
    // runDag, which calls channel.onMessage() exactly once.

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
                'terminalOutput': `done-${secondId}`,
                'errors': [],
                'stateSnapshot': null,
                'intermediates': [],
              },
            });
            setImmediate(() => {
              hostSide.send({
                'kind': 'result',
                'response': {
                  'correlationId': firstId,
                  'terminalOutput': `done-${firstId}`,
                  'errors': [],
                  'stateSnapshot': null,
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
            'terminalOutput': 'done',
            'errors': [],
            'stateSnapshot': null,
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
