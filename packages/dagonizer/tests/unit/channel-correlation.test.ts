/**
 * channel-correlation.test.ts
 *
 * Regression guard for the EventEmitter listener-accumulation bug:
 *   Before fix: DagContainerBase.runDag called channel.onMessage(handler) on
 *   every request, accumulating O(N) listeners on a pooled worker channel.
 *   After fix: ChannelDispatch installs exactly ONE channel.onMessage handler
 *   for the channel's lifetime; requestId routing demuxes all responses.
 *
 * What this test asserts:
 *   (a) Exactly ONE underlying subscription is installed regardless of request
 *       count — measured via a counting wrapper channel.
 *   (b) Results correlate correctly — each of N sequential requests gets its
 *       own outcome, never a cross-contaminated one.
 *   (c) No cross-talk — every response is delivered to the caller that sent
 *       the matching requestId.
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
 * 'execute' messages and echoes a 'result' message with the matching requestId
 * and a deterministic terminalOutput derived from the request. This lets the
 * test verify that requestId routing is correct.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DagContainerOptions } from '../../src/container/DagContainerBase.js';
import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { DagOutcomeInterface } from '../../src/contracts/DagOutcomeInterface.js';
import type { DagTaskInterface } from '../../src/contracts/DagTaskInterface.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { BridgeMessage } from '../../src/entities/executor/BridgeMessage.js';
import type { ExecutionRequest } from '../../src/entities/executor/ExecutionRequest.js';
import type { JsonObject } from '../../src/entities/json.js';
import type { NodeContextInterface } from '../../src/entities/node/NodeContext.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
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

function makeTask(requestId: string, signal: AbortSignal): DagTaskInterface<MinimalState, undefined> {
  const request: ExecutionRequest = {
    'dagName': 'test-dag',
    'placementPath': [],
    'stateSnapshot': {} as JsonObject,
    'timeoutMs': null,
    'requestId': requestId,
  };
  return {
    'dagName': 'test-dag',
    'placementPath': [],
    'requestId': requestId,
    'timeoutMs': null,
    'state': new MinimalState(),
    'context': {
      'signal': signal,
      'services': undefined,
    } as unknown as NodeContextInterface<undefined>,
    toRequest(): ExecutionRequest {
      return request;
    },
  };
}

// ---------------------------------------------------------------------------
// SingleChannelContainer: DagContainerBase that always returns the same channel
// ---------------------------------------------------------------------------

class SingleChannelContainer extends DagContainerBase<MinimalState> {
  readonly #channel: MessageChannelInterface;

  constructor(channel: MessageChannelInterface, options: DagContainerOptions = {}) {
    super(options);
    this.#channel = channel;
  }

  protected acquireChannel(): Promise<MessageChannelInterface> {
    return Promise.resolve(this.#channel);
  }

  protected releaseChannel(_channel: MessageChannelInterface): void {
    // Single-channel pool: no-op.
  }
}

// ---------------------------------------------------------------------------
// FakeHost: drives the host side of the LoopbackChannel.
//
// Receives 'init' → sends 'ready'.
// Receives 'execute' → sends 'result' with the matching requestId and
//   terminalOutput = 'done-' + requestId (deterministic per-request value).
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
      const { requestId } = msg.request;
      hostSide.send({
        'kind': 'result',
        'response': {
          'requestId': requestId,
          'terminalOutput': `done-${requestId}`,
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

describe('channel-correlation: single subscription + requestId demux', () => {

  it('(a) exactly ONE underlying onMessage subscription regardless of request count', async () => {
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

  it('(b) results correlate correctly — each request gets its own outcome', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    startFakeHost(hostSide);

    const container = new SingleChannelContainer(parentSide);

    const REQUEST_COUNT = 30;
    const ac = new AbortController();

    for (let i = 0; i < REQUEST_COUNT; i++) {
      const requestId = `req-${i}`;
      const task = makeTask(requestId, ac.signal);
      const outcome = await container.runDag(task);

      // (b) Each request must receive its own correlated terminalOutput.
      assert.strictEqual(
        outcome.terminalOutput,
        `done-${requestId}`,
        `Request ${requestId}: expected terminalOutput 'done-${requestId}', got '${outcome.terminalOutput}'`,
      );
    }
  });

  it('(c) no cross-talk — requestId routing delivers to the correct caller', async () => {
    // Drive two overlapping requests concurrently on the same channel.
    // The FakeHost delays the first response until after the second execute
    // is sent, verifying that each caller receives exactly its own response.

    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    // Custom host: collect execute messages and respond in reverse order
    // to prove requestId routing (not FIFO) assigns responses correctly.
    const pending: Array<{ requestId: string }> = [];
    hostSide.onMessage((msg) => {
      if (msg.kind === 'init') {
        hostSide.send({
          'kind': 'ready',
          'registryVersion': msg.registryVersion,
          'capabilities': [],
        });
      } else if (msg.kind === 'execute') {
        pending.push({ 'requestId': msg.request.requestId });
        // After collecting two requests, respond in REVERSE order.
        if (pending.length === 2) {
          const secondId = pending[1]?.requestId ?? '';
          const firstId = pending[0]?.requestId ?? '';
          // Respond to second first, then first.
          setImmediate(() => {
            hostSide.send({
              'kind': 'result',
              'response': {
                'requestId': secondId,
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
                  'requestId': firstId,
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
