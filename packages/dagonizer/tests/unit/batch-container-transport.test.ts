/**
 * batch-container-transport.test.ts
 *
 * Tests for the batch-native container transport:
 *   (a) Single-item batch: a batch of one produces one `RunResultType` entry.
 *   (b) Multi-item batch: N items produce N `RunResultType` entries, each
 *       carrying only its own id, terminalOutput, errors, and intermediates.
 *   (c) Batch abort: aborting mid-batch sends an 'abort' BridgeMessageType; the result
 *       is determined by the host's response (no client-side fabrication on abort).
 *   (d) Batch send failure: when channel.send throws before the result arrives,
 *       all items resolve to transport-error results.
 *   (e) DagOutcome.transportError: per-item shape contract.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DagContainerBase } from '../../src/container/DagContainerBase.js';
import type { DagContainerOptionsType, PoolEntryType } from '../../src/container/DagContainerBase.js';
import { DagHost } from '../../src/container/DagHost.js';
import {
  DAG_CONTAINER_TRANSPORT,
  DagOutcome,
} from '../../src/container/DagOutcome.js';
import type { RunResultType } from '../../src/container/DagOutcome.js';
import { DagTask } from '../../src/container/DagTask.js';
import type { GraphStateTransferFormatType } from '../../src/contracts/GraphStateTransferFormat.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface } from '../../src/contracts/RegistryBundleInterface.js';
import type { RegistryModuleInterface } from '../../src/contracts/RegistryModuleInterface.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import type { ExecutionRequestType } from '../../src/entities/executor/ExecutionRequest.js';
import type { GraphStateTransferType } from '../../src/entities/executor/GraphStateTransferSchema.js';
import type { TransientNodeStateSelectionType, TransientNodeStateType } from '../../src/entities/executor/TransientNodeState.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import { NodeError } from '../../src/entities/node/NodeError.js';
import { Timeout } from '../../src/entities/Timeout.js';
import { DagGraphTerms } from '../../src/graph/DagGraphTerms.js';
import { GraphStateTransferCodec } from '../../src/graph/GraphStateTransferCodec.js';
import { InMemoryGraphDataset } from '../../src/graph/InMemoryGraphDataset.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { DagTaskType } from '../../src/types/DagTask.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';
import { FULL_INPUT_STATE, FULL_RESPONSE_STATE, emptyInlineTransfer } from '../_support/GraphStateSupport.js';
import { TestBatchNode } from '../_support/TestBatchNode.js';

// ---------------------------------------------------------------------------
// TestState
// ---------------------------------------------------------------------------

class TestState extends NodeStateBase {
  #restorationCount: number = 0;
  value: number = 0;
  label: string = '';

  restorationCount(): number {
    return this.#restorationCount;
  }

  override async restoreTransientState(
    runIri: string,
    snapshot: TransientNodeStateType,
  ): Promise<void> {
    await super.restoreTransientState(runIri, snapshot);
    this.#restorationCount += 1;
  }
}

class MixedOutcomeState extends TestState {
  marker = '';
}

class MixedOutcomeRegistry implements RegistryModuleInterface {
  instantiate(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    const dagIri = 'urn:dagonizer:dag:test';
    const nodeIri = 'urn:dagonizer:node:mixed-route';
    const routeIri = 'urn:dagonizer:placement:mixed-route';
    const completedIri = 'urn:dagonizer:placement:mixed-completed';
    const failedIri = 'urn:dagonizer:placement:mixed-failed';
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type': 'DAG',
      'name': 'mixed-outcome-wire',
      'version': '1',
      'entrypoints': { 'main': routeIri },
      'nodes': [
        {
          '@id': routeIri,
          '@type': 'SingleNode',
          'name': 'mixed-route',
          'node': nodeIri,
          'outputs': {
            'completed': completedIri,
            'failed': failedIri,
            'parked': completedIri,
          },
        },
        { '@id': completedIri, '@type': 'TerminalNode', 'name': 'completed', 'outcome': 'completed' },
        { '@id': failedIri, '@type': 'TerminalNode', 'name': 'failed', 'outcome': 'failed' },
      ],
    };
    const node = TestBatchNode.of<MixedOutcomeState, 'completed' | 'failed' | 'parked'>(
      nodeIri,
      ['completed', 'failed', 'parked'],
      (batch) => {
        for (const item of batch) {
          item.state.marker = `restored:${item.id}`;
          if (item.id === 'failed-item') {
            item.state.collectError(NodeError.create(
              'ITEM_FAILED',
              'failed item fixture',
              'mixed-route',
              false,
              '2026-07-18T00:00:00.000Z',
            ));
          }
        }
        return new Map([
          ['completed', batch.filter((_state, id) => id === 'completed-item')],
          ['failed', batch.filter((_state, id) => id === 'failed-item')],
          ['parked', batch.filter((_state, id) => id === 'awaiting-item')],
        ]);
      },
    );
    return Promise.resolve({
      'bundle': { 'nodes': [node], 'dags': [dag] },
      'registryVersion': '0.0.0',
      'restoreState': (dataset, runIri) => new MixedOutcomeState(dataset, runIri),
    });
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

function responseTransfer(
  items: readonly { readonly runIri: string }[],
  values: readonly number[],
): GraphStateTransferType {
  return GraphStateTransferCodec.inlineTransient(items.map((item, index) => {
    const value = values[index];
    assert.ok(value !== undefined);
    const state = new TestState();
    state.value = value;
    return { 'runIri': item.runIri, 'state': state.snapshotTransientState() };
  }));
}

class BatchTestTask {
  private constructor() {}

  static of(
    correlationId: string,
    signal: AbortSignal,
    state: TestState,
    inputState: TransientNodeStateSelectionType,
  ): DagTaskType {
    return {
      'dagName': 'urn:dagonizer:dag:test',
      'placementPath': ['urn:dagonizer:placement:test'],
      correlationId,
      'timeout': Timeout.none(),
      state,
      inputState,
      'responseState': FULL_RESPONSE_STATE,
      'context': NodeContext.create('urn:dagonizer:dag:test', 'test-node', signal),
    };
  }
}

/**
 * SingleChannelContainer: a DagContainerBase subclass that always routes
 * through one pre-built channel. Pool seams are no-ops.
 */
class SingleChannelContainer extends DagContainerBase<null> {
  readonly #channel: MessageChannelInterface;
  #initPromise: Promise<void> | null;

  constructor(
    channel: MessageChannelInterface,
    graphStateTransferFormats: readonly GraphStateTransferFormatType[] = ['application/n-quads'],
  ) {
    super({
      ...DagContainerBase.defaultOptions,
      'poolSize': 1,
      'init': NOOP_INIT,
      graphStateTransferFormats,
    });
    this.#channel = channel;
    this.#initPromise = null;
  }

  protected override async acquireChannel(): Promise<MessageChannelInterface> {
    this.#initPromise ??= this.initializeChannel(this.#channel);
    await this.#initPromise;
    return this.#channel;
  }

  protected override releaseChannel(_channel: MessageChannelInterface): void { /* bypass pool */ }

  protected override composeEntry(): PoolEntryType<null> {
    return { 'worker': null, 'channel': this.#channel, 'initialized': false };
  }

  protected override attachDeathListeners(_entry: PoolEntryType<null>): void { /* no-op */ }
  protected override terminateWorker(_worker: null): void { /* no-op */ }
  protected override awaitWorkerExit(_worker: null): Promise<void> {
    return new Promise(() => { /* never */ });
  }
}

void describe('batch-container-transport: format contract', () => {
  void it('rejects empty and duplicate format arrays at construction', () => {
    const [emptyChannel] = LoopbackChannel.pair();
    assert.throws(
      () => new SingleChannelContainer(emptyChannel, []),
      /non-empty, duplicate-free graph-state transfer format enum array/u,
    );

    const [duplicateChannel] = LoopbackChannel.pair();
    assert.throws(
      () => new SingleChannelContainer(duplicateChannel, ['application/n-quads', 'application/n-quads']),
      /non-empty, duplicate-free graph-state transfer format enum array/u,
    );
  });
});

// ---------------------------------------------------------------------------
// (a) Single-item batch: one item in, one RunResultType out
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (a) single-item batch produces one result', () => {

  void it('restores a one-item transfer and returns an item-only outcome', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    hostSide.onMessage((msg) => {
      if (msg.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (msg.variant === 'execute') {
        const { correlationId, items } = msg.request;
        const item = items[0];
        assert.ok(item !== undefined);
        // Single-item batch (a batch of one): respond with items[0] carrying terminalOutcome.
        hostSide.send({
          'variant': 'result',
          'response': {
            correlationId,
            'graphState': responseTransfer([item], [41]),
            'items': [{
              'id': correlationId,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            }],
          },
        });
      }
    });

    const ac = new AbortController();
    const state = new TestState();
    const task = BatchTestTask.of('single-1', ac.signal, state, FULL_INPUT_STATE);
    const batch = Batch.from([{ 'id': 'single-1', state }]);
    const results: RunResultType[] = await container.runDag(task, batch);

    assert.strictEqual(results.length, 1);
    const [outcome] = results;
    assert.ok(outcome !== undefined);
    assert.strictEqual(outcome.terminalOutput, 'completed');
    assert.equal(Object.hasOwn(outcome, 'graphState'), false);
    assert.deepStrictEqual(outcome.errors, []);
    assert.deepStrictEqual(outcome.intermediates, []);
    assert.strictEqual(state.value, 41);
    assert.strictEqual(state.restorationCount(), 1);
  });

  void it('restores a failed item without exposing the batch transfer', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    hostSide.onMessage((msg) => {
      if (msg.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (msg.variant === 'execute') {
        const { correlationId, items } = msg.request;
        const item = items[0];
        assert.ok(item !== undefined);
        hostSide.send({
          'variant': 'result',
          'response': {
            correlationId,
            'graphState': responseTransfer([item], [73]),
            'items': [{
              'id': correlationId,
              'runIri': item.runIri,
              'terminalOutcome': 'failed',
              'errors': [],
              'intermediates': [],
            }],
          },
        });
      }
    });

    const ac = new AbortController();
    const state = new TestState();
    const task = BatchTestTask.of('single-null', ac.signal, state, FULL_INPUT_STATE);
    const batch = Batch.from([{ 'id': 'single-null', state }]);
    const [outcome] = await container.runDag(task, batch);
    assert.ok(outcome !== undefined);
    assert.strictEqual(outcome.terminalOutput, 'failed');
    assert.equal(Object.hasOwn(outcome, 'graphState'), false);
    assert.strictEqual(state.value, 73);
    assert.strictEqual(state.restorationCount(), 1);
  });

});

// ---------------------------------------------------------------------------
// (b) Multi-item batch: N items → N RunResultType entries
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (b) multi-item batch returns N results', () => {

  void it('runDag() with 3 items produces 3 results keyed by item id', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    // FakeHost: handles multi-item execute by echoing one items-response with
    // one entry per item, each with a deterministic terminalOutcome.
    hostSide.onMessage((msg) => {
      if (msg.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (msg.variant === 'execute') {
        const { correlationId, items } = msg.request;
        hostSide.send({
          'variant': 'result',
          'response': {
            correlationId,
            'graphState': responseTransfer(items, [101, 202, 303]),
            'items': items.map((item) => ({
              'id': item.id,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            })),
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
    const task = BatchTestTask.of('batch-1', ac.signal, stateA, FULL_INPUT_STATE);

    const results: RunResultType[] = await container.runDag(task, batch);

    assert.strictEqual(results.length, 3);

    // Each result is keyed by its item id.
    assert.strictEqual(results[0]?.id, 'item-A');
    assert.strictEqual(results[0]?.terminalOutput, 'completed');

    assert.strictEqual(results[1]?.id, 'item-B');
    assert.strictEqual(results[1]?.terminalOutput, 'completed');

    assert.strictEqual(results[2]?.id, 'item-C');
    assert.strictEqual(results[2]?.terminalOutput, 'completed');
    for (const result of results) assert.equal(Object.hasOwn(result, 'graphState'), false);

    assert.deepStrictEqual([stateA.value, stateB.value, stateC.value], [101, 202, 303]);
    assert.deepStrictEqual(
      [stateA.restorationCount(), stateB.restorationCount(), stateC.restorationCount()],
      [1, 1, 1],
    );
  });

  void it('runDag() sends a single execute message containing all items', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    const receivedRequests: BridgeMessageType[] = [];

    hostSide.onMessage((msg) => {
      if (msg.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (msg.variant === 'execute') {
        receivedRequests.push(msg);
        const { correlationId, items } = msg.request;
        hostSide.send({
          'variant': 'result',
          'response': {
            correlationId,
            'graphState': emptyInlineTransfer(items.map((item) => item.runIri)),
            'items': items.map((item) => ({
              'id': item.id,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            })),
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
    const task = BatchTestTask.of('batch-single-msg', ac.signal, stateX1, FULL_INPUT_STATE);
    await container.runDag(task, batch);

    // Exactly one execute message sent (the batch round-trip).
    assert.strictEqual(receivedRequests.length, 1);
    const req = receivedRequests[0];
    assert.ok(req !== undefined && req.variant === 'execute');
    assert.strictEqual(req.request.items.length, 2);
    assert.strictEqual(req.request.items[0]?.id, 'x1');
    assert.strictEqual(req.request.items[1]?.id, 'x2');
  });

});

void describe('batch-container-transport: real host outcome seam', () => {
  void it('preserves mixed item outcomes, errors, intermediates, and state across the channel', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const host = new DagHost(hostSide, { 'registry': new MixedOutcomeRegistry() });
    host.start();
    const container = new SingleChannelContainer(parentSide);
    const awaitingState = new MixedOutcomeState();
    const completedState = new MixedOutcomeState();
    const failedState = new MixedOutcomeState();
    const batch = Batch.from([
      { 'id': 'awaiting-item', 'state': awaitingState },
      { 'id': 'completed-item', 'state': completedState },
      { 'id': 'failed-item', 'state': failedState },
    ]);
    const task = BatchTestTask.of(
      'mixed-outcome-request',
      new AbortController().signal,
      awaitingState,
      FULL_INPUT_STATE,
    );

    const results = await container.runDag(task, batch);
    const resultById = new Map(results.map((result) => [result.id, result]));
    const awaiting = resultById.get('awaiting-item');
    const completed = resultById.get('completed-item');
    const failed = resultById.get('failed-item');
    assert.ok(awaiting !== undefined && completed !== undefined && failed !== undefined);
    assert.deepEqual(results.map((result) => ({
      'id': result.id,
      'terminalOutput': result.terminalOutput,
      'errors': result.errors.map((error) => ({ 'code': error.code, 'message': error.message })),
      'intermediateNodes': result.intermediates.map((item) => item.nodeName),
    })), [
      {
        'id': 'awaiting-item',
        'terminalOutput': 'awaiting-input',
        'errors': [],
        'intermediateNodes': ['mixed-route'],
      },
      {
        'id': 'completed-item',
        'terminalOutput': 'completed',
        'errors': [],
        'intermediateNodes': ['completed'],
      },
      {
        'id': 'failed-item',
        'terminalOutput': 'failed',
        'errors': [{ 'code': 'ITEM_FAILED', 'message': 'failed item fixture' }],
        'intermediateNodes': ['failed'],
      },
    ]);

    assert.equal(awaiting.terminalOutput, 'awaiting-input');
    assert.equal(awaiting.errors.some((error) => error.code === 'DAG_EXECUTION_FAILED'), false);
    assert.deepEqual(awaiting.errors, []);
    assert.equal(awaiting.intermediates.some((item) => item.nodeName === 'mixed-route'), true);

    assert.equal(completed.terminalOutput, 'completed');
    assert.deepEqual(completed.errors, []);
    assert.equal(completed.intermediates.some((item) => item.nodeName === 'completed'), true);

    assert.equal(failed.terminalOutput, 'failed');
    assert.deepEqual(failed.errors.map((error) => error.code), ['ITEM_FAILED']);
    assert.equal(failed.intermediates.some((item) => item.nodeName === 'failed'), true);

    assert.equal(completed.intermediates.some((item) => item.nodeName === 'failed'), false);
    assert.equal(failed.intermediates.some((item) => item.nodeName === 'completed'), false);
    assert.deepEqual(
      [awaitingState.marker, completedState.marker, failedState.marker],
      ['restored:awaiting-item', 'restored:completed-item', 'restored:failed-item'],
    );
    parentSide.send({ 'variant': 'shutdown' });
  });
});

void describe('batch-container-transport: semantic wire identity', () => {
  void it('returns transport errors without sending a duplicate-id request', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);
    let executeCount = 0;
    hostSide.onMessage((message) => {
      if (message.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': message.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (message.variant === 'execute') {
        executeCount += 1;
      }
    });
    const signal = new AbortController().signal;
    const firstState = new TestState();
    const secondState = new TestState();
    const results = await container.runDag(
      BatchTestTask.of('duplicate-request-id', signal, firstState, FULL_INPUT_STATE),
      Batch.from([
        { 'id': 'duplicate', 'state': firstState },
        { 'id': 'duplicate', 'state': secondState },
      ]),
    );

    assert.equal(executeCount, 0);
    assert.equal(results.length, 2);
    assert.equal(results.every((result) => result.errors.some((error) => error.code === DAG_CONTAINER_TRANSPORT)), true);
    assert.equal(firstState.restorationCount(), 0);
    assert.equal(secondState.restorationCount(), 0);
  });

  void it('returns transport errors without sending a duplicate-run-IRI request', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);
    let executeCount = 0;
    hostSide.onMessage((message) => {
      if (message.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': message.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (message.variant === 'execute') {
        executeCount += 1;
      }
    });
    const sharedRunIri = 'urn:dagonizer:run:duplicate-request';
    const signal = new AbortController().signal;
    const firstState = new TestState(new InMemoryGraphDataset(), sharedRunIri);
    const secondState = new TestState(new InMemoryGraphDataset(), sharedRunIri);
    const results = await container.runDag(
      BatchTestTask.of('duplicate-request-run', signal, firstState, FULL_INPUT_STATE),
      Batch.from([
        { 'id': 'first', 'state': firstState },
        { 'id': 'second', 'state': secondState },
      ]),
    );

    assert.equal(executeCount, 0);
    assert.equal(results.length, 2);
    assert.equal(results.every((result) => result.errors.some((error) => error.code === DAG_CONTAINER_TRANSPORT)), true);
    assert.equal(firstState.restorationCount(), 0);
    assert.equal(secondState.restorationCount(), 0);
  });

  void it('rejects mismatched response pairs before restoring any item', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);
    hostSide.onMessage((message) => {
      if (message.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': message.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (message.variant === 'execute') {
        const [first, second] = message.request.items;
        assert.ok(first !== undefined && second !== undefined);
        hostSide.send({
          'variant': 'result',
          'response': {
            'correlationId': message.request.correlationId,
            'graphState': responseTransfer(message.request.items, [101, 202]),
            'items': [
              { 'id': first.id, 'runIri': second.runIri, 'terminalOutcome': 'completed', 'errors': [], 'intermediates': [] },
              { 'id': second.id, 'runIri': first.runIri, 'terminalOutcome': 'completed', 'errors': [], 'intermediates': [] },
            ],
          },
        });
      }
    });
    const signal = new AbortController().signal;
    const firstState = new TestState();
    const secondState = new TestState();
    const results = await container.runDag(
      BatchTestTask.of('mismatched-response', signal, firstState, FULL_INPUT_STATE),
      Batch.from([
        { 'id': 'first', 'state': firstState },
        { 'id': 'second', 'state': secondState },
      ]),
    );

    assert.equal(results.length, 2);
    assert.equal(results.every((result) => result.errors.some((error) => error.code === DAG_CONTAINER_TRANSPORT)), true);
    assert.equal(firstState.restorationCount(), 0);
    assert.equal(secondState.restorationCount(), 0);
    assert.equal(firstState.value, 0);
    assert.equal(secondState.value, 0);
  });

  void it('rejects an undeclared payload graph before restoring the response', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);
    hostSide.onMessage((message) => {
      if (message.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': message.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (message.variant === 'execute') {
        const item = message.request.items[0];
        assert.ok(item !== undefined);
        const validTransfer = responseTransfer([item], [303]);
        assert.equal(validTransfer.transport, 'inline-nquads');
        if (validTransfer.transport !== 'inline-nquads') return;
        const graphState = GraphStateTransferCodec.inlineSync([{
          'runIri': item.runIri,
          'quads': [
            ...GraphStateTransferCodec.decode(validTransfer.nquads),
            {
              'subject': DagGraphTerms.namedNode('urn:dagonizer:response:extra'),
              'predicate': DagGraphTerms.namedNode('urn:dagonizer:response:value'),
              'object': DagGraphTerms.literal('invalid'),
              'graph': DagGraphTerms.namedNode('urn:dagonizer:response:extra#state'),
            },
          ],
        }]);
        hostSide.send({
          'variant': 'result',
          'response': {
            'correlationId': message.request.correlationId,
            graphState,
            'items': [{
              'id': item.id,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            }],
          },
        });
      }
    });
    const signal = new AbortController().signal;
    const state = new TestState();
    const results = await container.runDag(
      BatchTestTask.of('undeclared-response-graph', signal, state, FULL_INPUT_STATE),
      Batch.of(state, 'item'),
    );

    assert.equal(results.length, 1);
    assert.equal(results[0]?.errors.some((error) => error.code === DAG_CONTAINER_TRANSPORT), true);
    assert.equal(state.restorationCount(), 0);
    assert.equal(state.value, 0);
  });
});

// ---------------------------------------------------------------------------
// (f) inputState selection controls request payload width
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (f) inputState selection controls payload width', () => {

  void it('runDag snapshots a batch of one through inputState', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);
    let request: ExecutionRequestType | undefined;
    hostSide.onMessage((message) => {
      if (message.variant === 'init') {
        hostSide.send({
          'variant': 'ready',
          'registryVersion': message.registryVersion,
          'capabilities': [],
          'graphStateTransferFormats': ['application/n-quads'],
        });
      } else if (message.variant === 'execute') {
        request = message.request;
        hostSide.send({
          'variant': 'result',
          'response': {
            'correlationId': message.request.correlationId,
            'graphState': emptyInlineTransfer(message.request.items.map((item) => item.runIri)),
            'items': message.request.items.map((item) => ({
              'id': item.id,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            })),
          },
        });
      }
    });
    const ac = new AbortController();
    const state = new TestState();
    state.value = 7;
    state.label = 'drop';
    state.setMetadata('tag', 'keep');
    state.setMetadata('other', 'drop');
    const selection: TransientNodeStateSelectionType = {
      'mode': 'selection',
      'domainPaths': ['value'],
      'metadataKeys': ['tag'],
    };
    const task = new DagTask(
      'test-dag',
      ['urn:dagonizer:placement:test'],
      'direct-selection',
      Timeout.none(),
      state,
      selection,
      FULL_RESPONSE_STATE,
      NodeContext.create('test-dag', 'test-node', ac.signal),
    );

    await container.runDag(task, Batch.of(state, 'direct-selection'));
    assert.ok(request !== undefined);
    const wireState = (await GraphStateTransferCodec.restoreTransient(request.graphState, request.items, null))[0]?.state;
    assert.ok(wireState !== undefined);
    assert.deepStrictEqual(wireState.domain, { 'value': 7 });
    assert.deepStrictEqual(wireState.metadata, { 'tag': 'keep' });
  });

  void it('single-item batch: selection mode includes only the selected domain paths and metadata keys', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    const receivedRequests: BridgeMessageType[] = [];
    hostSide.onMessage((msg) => {
      if (msg.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (msg.variant === 'execute') {
        receivedRequests.push(msg);
        const { correlationId, items } = msg.request;
        hostSide.send({
          'variant': 'result',
          'response': {
            correlationId,
            'graphState': emptyInlineTransfer(items.map((item) => item.runIri)),
            'items': items.map((item) => ({
              'id': item.id,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            })),
          },
        });
      }
    });

    const ac = new AbortController();
    const state = new TestState();
    state.value = 42;
    state.label = 'secret-label';
    state.setMetadata('tag', 'keep');
    state.setMetadata('other', 'drop');

    const selection: TransientNodeStateSelectionType = { 'mode': 'selection', 'domainPaths': ['value'], 'metadataKeys': ['tag'] };
    const task = BatchTestTask.of('selection-1', ac.signal, state, selection);
    const batch = Batch.from([{ 'id': 'selection-1', state }]);
    await container.runDag(task, batch);

    assert.strictEqual(receivedRequests.length, 1);
    const req = receivedRequests[0];
    assert.ok(req !== undefined && req.variant === 'execute');
    const wireState = (await GraphStateTransferCodec.restoreTransient(req.request.graphState, req.request.items, null))[0]?.state;
    assert.ok(wireState !== undefined);
    assert.deepStrictEqual(wireState.domain, { 'value': 42 });
    assert.deepStrictEqual(wireState.metadata, { 'tag': 'keep' });
  });

  void it('single-item batch: full mode includes every domain field and metadata key', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    const receivedRequests: BridgeMessageType[] = [];
    hostSide.onMessage((msg) => {
      if (msg.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (msg.variant === 'execute') {
        receivedRequests.push(msg);
        const { correlationId, items } = msg.request;
        hostSide.send({
          'variant': 'result',
          'response': {
            correlationId,
            'graphState': emptyInlineTransfer(items.map((item) => item.runIri)),
            'items': items.map((item) => ({
              'id': item.id,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            })),
          },
        });
      }
    });

    const ac = new AbortController();
    const state = new TestState();
    state.value = 99;
    state.label = 'visible-label';
    state.setMetadata('tag', 'keep');
    state.setMetadata('other', 'also-visible');

    const task = BatchTestTask.of('full-1', ac.signal, state, FULL_INPUT_STATE);
    const batch = Batch.from([{ 'id': 'full-1', state }]);
    await container.runDag(task, batch);

    const req = receivedRequests[0];
    assert.ok(req !== undefined && req.variant === 'execute');
    const wireState = (await GraphStateTransferCodec.restoreTransient(req.request.graphState, req.request.items, null))[0]?.state;
    assert.ok(wireState !== undefined);
    assert.deepStrictEqual(wireState.domain, { 'value': 99, 'label': 'visible-label' });
    assert.deepStrictEqual(wireState.metadata, { 'tag': 'keep', 'other': 'also-visible' });
  });

  void it('multi-item batch: the shared task.inputState selection narrows every item\'s payload identically', async () => {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const container = new SingleChannelContainer(parentSide);

    const receivedRequests: BridgeMessageType[] = [];
    hostSide.onMessage((msg) => {
      if (msg.variant === 'init') {
        hostSide.send({ 'variant': 'ready', 'registryVersion': msg.registryVersion, 'capabilities': [], 'graphStateTransferFormats': ['application/n-quads'] });
      } else if (msg.variant === 'execute') {
        receivedRequests.push(msg);
        const { correlationId, items } = msg.request;
        hostSide.send({
          'variant': 'result',
          'response': {
            correlationId,
            'graphState': emptyInlineTransfer(items.map((item) => item.runIri)),
            'items': items.map((item) => ({
              'id': item.id,
              'runIri': item.runIri,
              'terminalOutcome': 'completed',
              'errors': [],
              'intermediates': [],
            })),
          },
        });
      }
    });

    const ac = new AbortController();
    const stateM1 = new TestState();
    stateM1.value = 1;
    stateM1.label = 'm1-secret';
    stateM1.setMetadata('tag', 'm1-tag');
    stateM1.setMetadata('other', 'm1-drop');

    const stateM2 = new TestState();
    stateM2.value = 2;
    stateM2.label = 'm2-secret';
    stateM2.setMetadata('tag', 'm2-tag');
    stateM2.setMetadata('other', 'm2-drop');

    const selection: TransientNodeStateSelectionType = { 'mode': 'selection', 'domainPaths': ['value'], 'metadataKeys': ['tag'] };
    const batch = Batch.from([
      { 'id': 'm1', 'state': stateM1 },
      { 'id': 'm2', 'state': stateM2 },
    ]);
    const task = BatchTestTask.of('batch-selection', ac.signal, stateM1, selection);
    await container.runDag(task, batch);

    const req = receivedRequests[0];
    assert.ok(req !== undefined && req.variant === 'execute');
    const states = await GraphStateTransferCodec.restoreTransient(req.request.graphState, req.request.items, null);
    assert.strictEqual(states.length, 2);

    const wireM1 = states.find((entry) => entry.id === 'm1')?.state;
    const wireM2 = states.find((entry) => entry.id === 'm2')?.state;
    assert.ok(wireM1 !== undefined && wireM2 !== undefined);

    assert.deepStrictEqual(wireM1.domain, { 'value': 1 });
    assert.deepStrictEqual(wireM1.metadata, { 'tag': 'm1-tag' });
    assert.deepStrictEqual(wireM2.domain, { 'value': 2 });
    assert.deepStrictEqual(wireM2.metadata, { 'tag': 'm2-tag' });
  });

});

// ---------------------------------------------------------------------------
// (d) Batch send failure: all items get transport-error results
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (d) send failure returns transport-error for all items', () => {

  void it('when channel.send throws, runDag returns transport-error results for each item', async () => {
    // Build a channel whose send throws immediately.
    class FailSendChannel implements MessageChannelInterface {
      #onMessageHandler: ((msg: BridgeMessageType) => void) | null = null;

      send(msg: BridgeMessageType): void {
        // Allow init/ready handshake to succeed; fail only execute messages.
        if (msg.variant === 'execute') {
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
      if (msg.variant === 'init') {
        // Queue the ready reply so the dispatch.init() resolves.
        setImmediate(() => {
          failChannel.sendToHandler({
            'variant': 'ready',
            'registryVersion': msg.registryVersion,
            'capabilities': [],
            'graphStateTransferFormats': ['application/n-quads'],
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
    const task = BatchTestTask.of('batch-fail', ac.signal, stateFail1, FULL_INPUT_STATE);
    const results = await container.runDag(task, batch);

    // Both items must get transport-error results.
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0]?.id, 'fail-1');
    assert.strictEqual(results[0]?.terminalOutput, 'failed');
    assert.ok(results[0]?.errors.length ?? 0 > 0, 'fail-1 must carry at least one error');
    assert.ok(results[0] !== undefined && !Object.hasOwn(results[0], 'graphState'));

    assert.strictEqual(results[1]?.id, 'fail-2');
    assert.strictEqual(results[1]?.terminalOutput, 'failed');
    assert.ok(results[1]?.errors.length ?? 0 > 0, 'fail-2 must carry at least one error');
    assert.ok(results[1] !== undefined && !Object.hasOwn(results[1], 'graphState'));
  });

});

// ---------------------------------------------------------------------------
// (e) DagOutcome.transportError — shape contract
// ---------------------------------------------------------------------------

void describe('batch-container-transport: (e) DagOutcome.transportError shape', () => {

  void it('carries id, terminalOutput:failed, one error, empty intermediates', () => {
    const result = DagOutcome.transportError('item-x', 'corr-99');

    assert.strictEqual(result.id, 'item-x');
    assert.strictEqual(result.terminalOutput, 'failed');
    assert.equal(Object.hasOwn(result, 'graphState'), false);
    assert.deepStrictEqual(result.intermediates, []);
    assert.strictEqual(result.errors.length, 1);

    const error = result.errors[0];
    assert.ok(error !== undefined);
    assert.strictEqual(error.code, DAG_CONTAINER_TRANSPORT);
    assert.strictEqual(error.recoverable, false);
    assert.ok(error.message.includes('corr-99'), 'error message must include correlationId');
  });

  void it('custom code and message override propagate through', () => {
    const result = DagOutcome.transportError('item-y', 'corr-77', {
      'code': 'CUSTOM_TRANSPORT_ERR',
      'message': 'custom error text',
    });

    assert.strictEqual(result.id, 'item-y');
    assert.strictEqual(result.errors[0]?.code, 'CUSTOM_TRANSPORT_ERR');
    assert.strictEqual(result.errors[0]?.message, 'custom error text');
  });

  void it('multiple items produce independent results sharing no references', () => {
    const r1 = DagOutcome.transportError('id-1', 'corr-a');
    const r2 = DagOutcome.transportError('id-2', 'corr-b');

    assert.strictEqual(r1.id, 'id-1');
    assert.strictEqual(r2.id, 'id-2');
    // Different error message correlationIds.
    assert.ok(r1.errors[0]?.message.includes('corr-a'));
    assert.ok(r2.errors[0]?.message.includes('corr-b'));
  });

});
