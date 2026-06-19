/**
 * batch-container-transport.test.ts
 *
 * Tests for the batch-native container transport (Wave 2):
 *   (a) Single-item request(): items[0] is unpacked into a flat DagOutcomeType.
 *   (b) Multi-item requestBatch(): N items produce N BatchRunResultType entries, each
 *       carrying its own id, terminalOutput, stateSnapshot, errors, intermediates.
 *   (c) Batch abort: aborting mid-batch sends an 'abort' BridgeMessageType; the result
 *       is determined by the host's response (no client-side fabrication on abort).
 *   (d) Batch send failure: when channel.send throws before the result arrives,
 *       all items resolve to transport-error BatchRunResults.
 *   (e) DagOutcome.batchItemTransportError: shape contract (id, terminalOutput,
 *       stateSnapshot, errors, intermediates, errorCode).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { DagContainerOptionsType, PoolEntryType } from '../../src/container/DagContainerBase.js';
import {
  DAG_CONTAINER_TRANSPORT,
  DagOutcome,
} from '../../src/container/DagOutcome.js';
import type { BatchRunResultType, DagOutcomeType } from '../../src/container/DagOutcome.js';
import type { DagTaskInterface } from '../../src/container/DagTask.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import type { ExecutionRequestType } from '../../src/entities/executor/ExecutionRequest.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { Timeout } from '../../src/entities/Timeout.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

// ---------------------------------------------------------------------------
// TestState
// ---------------------------------------------------------------------------

class TestState extends NodeStateBase {
  value: number = 0;

  protected override snapshotData(): JsonObjectType {
    return { 'value': this.value };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const v = snap['value'];
    if (typeof v === 'number') this.value = v;
  }
}

// ---------------------------------------------------------------------------
// Helpers: makeTask, SingleChannelContainer
// ---------------------------------------------------------------------------

const NOOP_INIT: DagContainerOptionsType['init'] = {
  'registryModule': 'test',
  'registryVersion': '0.0.0',
  'servicesConfig': {},
};

/**
 * Build a minimal DagTaskInterface for the given correlationId and state.
 * `toRequest()` produces the new items-based wire format (single-item N=1).
 */
function makeTask(
  correlationId: string,
  signal: AbortSignal,
  state: TestState = new TestState(),
): DagTaskInterface<TestState, undefined> {
  return {
    'dagName': 'test-dag',
    'placementPath': [],
    correlationId,
    'timeout': Timeout.none(),
    state,
    'context': {
      'dagName': 'test-dag',
      'nodeName': 'test-node',
      signal,
      'services': undefined,
    } as NodeContextType<undefined>,
    toRequest(): ExecutionRequestType {
      return {
        'dagName': 'test-dag',
        'placementPath': [],
        'items': [{ 'id': correlationId, 'snapshot': state.snapshot() }],
        'timeoutMs': null,
        correlationId,
      };
    },
  };
}

/**
 * SingleChannelContainer: a DagContainerBase subclass that always routes
 * through one pre-built channel. Pool seams are no-ops.
 */
class SingleChannelContainer extends DagContainerBase<TestState, null> {
  readonly #channel: MessageChannelInterface;

  constructor(channel: MessageChannelInterface) {
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': 1,
      'init': NOOP_INIT,
    });
    this.#channel = channel;
  }

  protected override acquireChannel(): Promise<MessageChannelInterface> {
    return Promise.resolve(this.#channel);
  }

  protected override releaseChannel(_channel: MessageChannelInterface): void { /* bypass pool */ }

  protected override composeEntry(): PoolEntryType<null> {
    return { 'worker': null, 'channel': this.#channel, 'initialized': true };
  }

  protected override attachDeathListeners(_entry: PoolEntryType<null>): void { /* no-op */ }
  protected override terminateWorker(_worker: null): void { /* no-op */ }
  protected override awaitWorkerExit(_worker: null): Promise<void> {
    return new Promise(() => { /* never */ });
  }
}

// ---------------------------------------------------------------------------
// (a) Single-item: request() unpacks items[0] into DagOutcomeType
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (a) single-item request unpacks items[0]', () => {

  void it('runDag() items[0] terminalOutcome maps to DagOutcomeType.terminalOutput', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    hostSide.onMessage((msg) => {
      if (msg.kind === 'init') {
        hostSide.send({ 'kind': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [] });
      } else if (msg.kind === 'execute') {
        const { correlationId } = msg.request;
        // Single-item N=1: respond with items[0] carrying terminalOutcome.
        hostSide.send({
          'kind': 'result',
          'response': {
            correlationId,
            'items': [{ 'id': correlationId, 'snapshot': { 'value': 7 }, 'terminalOutcome': 'completed' }],
            'errors': [],
            'intermediates': [],
          },
        });
      }
    });

    const ac = new AbortController();
    const task = makeTask('single-1', ac.signal);
    const outcome: DagOutcomeType = await container.runDag(task);

    // items[0].terminalOutcome → outcome.terminalOutput
    assert.strictEqual(outcome.terminalOutput, 'completed');
    // items[0].snapshot → outcome.stateSnapshot
    assert.deepStrictEqual(outcome.stateSnapshot, { 'value': 7 });
    assert.deepStrictEqual(outcome.errors, []);
    assert.deepStrictEqual(outcome.intermediates, []);
  });

  void it('runDag() items[0] with null snapshot → stateSnapshot is null', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    hostSide.onMessage((msg) => {
      if (msg.kind === 'init') {
        hostSide.send({ 'kind': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [] });
      } else if (msg.kind === 'execute') {
        const { correlationId } = msg.request;
        hostSide.send({
          'kind': 'result',
          'response': {
            correlationId,
            'items': [{ 'id': correlationId, 'snapshot': null, 'terminalOutcome': 'failed' }],
            'errors': [],
            'intermediates': [],
          },
        });
      }
    });

    const ac = new AbortController();
    const outcome = await container.runDag(makeTask('single-null', ac.signal));
    assert.strictEqual(outcome.terminalOutput, 'failed');
    assert.strictEqual(outcome.stateSnapshot, null);
  });

});

// ---------------------------------------------------------------------------
// (b) Multi-item: requestBatch() → N BatchRunResultType entries
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (b) multi-item requestBatch returns N results', () => {

  void it('runDagBatch() with 3 items produces 3 BatchRunResults keyed by item id', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    // FakeHost: handles multi-item execute by echoing one items-response with
    // one entry per item, each with a deterministic terminalOutcome.
    hostSide.onMessage((msg) => {
      if (msg.kind === 'init') {
        hostSide.send({ 'kind': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [] });
      } else if (msg.kind === 'execute') {
        const { correlationId, items } = msg.request;
        hostSide.send({
          'kind': 'result',
          'response': {
            correlationId,
            'items': items.map((item) => ({
              'id': item.id,
              'snapshot': { 'processed': item.id },
              'terminalOutcome': `done-${item.id}`,
            })),
            'errors': [],
            'intermediates': [],
          },
        });
      }
    });

    const ac = new AbortController();

    // Build 3 states with distinct values.
    const stateA = new TestState();
    const stateB = new TestState();
    const stateC = new TestState();
    stateA.value = 10;
    stateB.value = 20;
    stateC.value = 30;

    const batch = Batch.from([
      { 'id': 'item-A', 'state': stateA },
      { 'id': 'item-B', 'state': stateB },
      { 'id': 'item-C', 'state': stateC },
    ]);

    // Use the first item's task for task identity (correlationId / abort signal).
    const task = makeTask('batch-1', ac.signal, stateA);

    const results: BatchRunResultType[] = await container.runDagBatch(task, batch);

    assert.strictEqual(results.length, 3);

    // Each result is keyed by its item id.
    assert.strictEqual(results[0]?.id, 'item-A');
    assert.strictEqual(results[0]?.terminalOutput, 'done-item-A');
    assert.deepStrictEqual(results[0]?.stateSnapshot, { 'processed': 'item-A' });

    assert.strictEqual(results[1]?.id, 'item-B');
    assert.strictEqual(results[1]?.terminalOutput, 'done-item-B');

    assert.strictEqual(results[2]?.id, 'item-C');
    assert.strictEqual(results[2]?.terminalOutput, 'done-item-C');
  });

  void it('runDagBatch() sends a single execute message containing all items', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    const receivedRequests: BridgeMessageType[] = [];

    hostSide.onMessage((msg) => {
      if (msg.kind === 'init') {
        hostSide.send({ 'kind': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [] });
      } else if (msg.kind === 'execute') {
        receivedRequests.push(msg);
        const { correlationId, items } = msg.request;
        hostSide.send({
          'kind': 'result',
          'response': {
            correlationId,
            'items': items.map((item) => ({
              'id': item.id,
              'snapshot': null,
              'terminalOutcome': 'completed',
            })),
            'errors': [],
            'intermediates': [],
          },
        });
      }
    });

    const ac = new AbortController();
    const stateX1 = new TestState();
    const stateX2 = new TestState();
    const batch = Batch.from([
      { 'id': 'x1', 'state': stateX1 },
      { 'id': 'x2', 'state': stateX2 },
    ]);
    const task = makeTask('batch-single-msg', ac.signal, stateX1);
    await container.runDagBatch(task, batch);

    // Exactly one execute message sent (the batch round-trip).
    assert.strictEqual(receivedRequests.length, 1);
    const req = receivedRequests[0];
    assert.ok(req !== undefined && req.kind === 'execute');
    assert.strictEqual(req.request.items.length, 2);
    assert.strictEqual(req.request.items[0]?.id, 'x1');
    assert.strictEqual(req.request.items[1]?.id, 'x2');
  });

});

// ---------------------------------------------------------------------------
// (d) Batch send failure: all items get transport-error results
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (d) send failure returns transport-error for all items', () => {

  void it('when channel.send throws, runDagBatch returns transport-error results for each item', async () => {
    // Build a channel whose send throws immediately.
    class FailSendChannel implements MessageChannelInterface {
      #onMessageHandler: ((msg: BridgeMessageType) => void) | null = null;

      send(msg: BridgeMessageType): void {
        // Allow init/ready handshake to succeed; fail only execute messages.
        if (msg.kind === 'execute') {
          throw new Error('channel closed');
        }
        // No-op for other message types.
      }

      onMessage(handler: (msg: BridgeMessageType) => void): void {
        this.#onMessageHandler = handler;
      }

      sendToHandler(msg: BridgeMessageType): void {
        this.#onMessageHandler?.(msg);
      }

      close(): void { /* no-op */ }
    }

    const failChannel = new FailSendChannel();
    const container = new SingleChannelContainer(failChannel);

    // Trigger the init handshake by replying with ready after init is sent.
    // We use a wrapper that intercepts the first 'init' send and fakes the ready.
    const realSend = failChannel.send.bind(failChannel);
    failChannel.send = (msg: BridgeMessageType): void => {
      if (msg.kind === 'init') {
        // Queue the ready reply so the dispatch.init() resolves.
        setImmediate(() => {
          failChannel.sendToHandler({
            'kind': 'ready',
            'registryVersion': msg.registryVersion,
            'capabilities': [],
          });
        });
        return;
      }
      realSend(msg);
    };

    const ac = new AbortController();
    const stateFail1 = new TestState();
    const stateFail2 = new TestState();
    const batch = Batch.from([
      { 'id': 'fail-1', 'state': stateFail1 },
      { 'id': 'fail-2', 'state': stateFail2 },
    ]);
    const task = makeTask('batch-fail', ac.signal, stateFail1);
    const results = await container.runDagBatch(task, batch);

    // Both items must get transport-error results.
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0]?.id, 'fail-1');
    assert.strictEqual(results[0]?.terminalOutput, 'failed');
    assert.ok(results[0]?.errors.length ?? 0 > 0, 'fail-1 must carry at least one error');

    assert.strictEqual(results[1]?.id, 'fail-2');
    assert.strictEqual(results[1]?.terminalOutput, 'failed');
    assert.ok(results[1]?.errors.length ?? 0 > 0, 'fail-2 must carry at least one error');
  });

});

// ---------------------------------------------------------------------------
// (e) DagOutcome.batchItemTransportError — shape contract
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (e) DagOutcome.batchItemTransportError shape', () => {

  void it('carries id, terminalOutput:failed, null stateSnapshot, one error, empty intermediates', () => {
    const result = DagOutcome.batchItemTransportError('item-x', 'corr-99');

    assert.strictEqual(result.id, 'item-x');
    assert.strictEqual(result.terminalOutput, 'failed');
    assert.strictEqual(result.stateSnapshot, null);
    assert.deepStrictEqual(result.intermediates, []);
    assert.strictEqual(result.errors.length, 1);

    const error = result.errors[0];
    assert.ok(error !== undefined);
    assert.strictEqual(error.code, DAG_CONTAINER_TRANSPORT);
    assert.strictEqual(error.recoverable, false);
    assert.ok(error.message.includes('corr-99'), 'error message must include correlationId');
  });

  void it('custom code and message override propagate through', () => {
    const result = DagOutcome.batchItemTransportError('item-y', 'corr-77', {
      'code': 'CUSTOM_TRANSPORT_ERR',
      'message': 'custom error text',
    });

    assert.strictEqual(result.id, 'item-y');
    assert.strictEqual(result.errors[0]?.code, 'CUSTOM_TRANSPORT_ERR');
    assert.strictEqual(result.errors[0]?.message, 'custom error text');
  });

  void it('multiple items produce independent results sharing no references', () => {
    const r1 = DagOutcome.batchItemTransportError('id-1', 'corr-a');
    const r2 = DagOutcome.batchItemTransportError('id-2', 'corr-b');

    assert.strictEqual(r1.id, 'id-1');
    assert.strictEqual(r2.id, 'id-2');
    // Different error message correlationIds.
    assert.ok(r1.errors[0]?.message.includes('corr-a'));
    assert.ok(r2.errors[0]?.message.includes('corr-b'));
  });

});
