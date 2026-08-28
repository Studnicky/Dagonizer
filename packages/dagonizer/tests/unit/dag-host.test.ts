/**
 * dag-host.test.ts
 *
 * DagHost protocol unit tests over a LoopbackChannel.
 *
 * All tests use the ConformanceRegistry (compiled to dist-testing/) as the
 * registry module URL so DagHost can dynamic-import it. The registry bundles
 * the conformance nodes and DAGs (body law1–law9) which are simple enough
 * for protocol testing without additional fixtures.
 *
 * Tests:
 *   - init handshake: ready reply with matching registryVersion
 *   - init version mismatch: error with VERSION_MISMATCH code
 *   - init non-existent module: error with INIT_FAILED code
 *   - init invalid module (no instantiate): INVALID_REGISTRY_MODULE error
 *   - execute a dag: result with one item outcome and item-local intermediates
 *   - execute forwards intermediate messages
 *   - abort fires the AbortController (sleeper terminates)
 *   - shutdown closes the channel
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DagHost } from '../../src/container/DagHost.js';
import type { GraphDatasetInterface } from '../../src/contracts/GraphDatasetInterface.js';
import { DEFAULT_GRAPH_STATE_TRANSFER_FORMATS } from '../../src/contracts/GraphStateTransferFormat.js';
import type { GraphStateTransferFormatType } from '../../src/contracts/GraphStateTransferFormat.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface } from '../../src/contracts/RegistryBundleInterface.js';
import type { RegistryModuleInterface } from '../../src/contracts/RegistryModuleInterface.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { GraphStateTerms } from '../../src/graph/GraphStateTerms.js';
import { GraphStateTransferCodec } from '../../src/graph/GraphStateTransferCodec.js';
import { InMemoryGraphDataset } from '../../src/graph/InMemoryGraphDataset.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';
import { FULL_RESPONSE_STATE, inlineTransferEntries } from '../_support/GraphStateSupport.js';
import { TestBatchNode } from '../_support/TestBatchNode.js';

// ---------------------------------------------------------------------------
// Registry module URL for DagHost dynamic import. Package export resolution is
// invariant between source and compiled test execution.
// ---------------------------------------------------------------------------

const REGISTRY_MODULE_URL = fileURLToPath(new URL(
  'ConformanceRegistry.js',
  import.meta.resolve('@studnicky/dagonizer/testing'),
));
const REGISTRY_VERSION = '1.0.0';
const BODY_LAW1_DAG = 'urn:conformance:dag:conformance-body-law1';
const BODY_LAW2_DAG = 'urn:conformance:dag:conformance-body-law2';
const BODY_LAW5_DAG = 'urn:conformance:dag:conformance-body-law5';
const COUNTING_DAG = 'urn:noocodec:dag:host-dispatcher-counting';
const ROUTED_DAG = 'urn:noocodec:dag:host-route-selection';

// A module URL that exists but is not a registry module (no instantiate export).
const INVALID_MODULE_URL = fileURLToPath(import.meta.resolve('@studnicky/dagonizer'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TestHostPair {
  private static readonly parentSides: MessageChannelInterface[] = [];

  private constructor() {}
  static create(registry?: RegistryModuleInterface): { host: DagHost; parentSide: MessageChannelInterface } {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const host = new DagHost(hostSide, registry === undefined ? {} : { registry });
    host.start();
    TestHostPair.parentSides.push(parentSide);
    return { host, parentSide };
  }

  static async cleanup(): Promise<void> {
    const parentSides = TestHostPair.parentSides.splice(0);
    for (const parentSide of parentSides) {
      try { parentSide.send({ 'variant': 'shutdown' }); } catch { /* already closed */ }
    }
    // Real timers are intentional: host shutdown is dispatched across the platform message channel.
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

class RouteSelectionState extends NodeStateBase {
  successValue = '';
  errorValue = '';
  sharedValue = '';
}

class RouteSelectionRegistry implements RegistryModuleInterface {
  instantiate(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    const nodeIri = 'urn:noocodec:node:host-route-selection';
    const placementIri = `${ROUTED_DAG}/node/route`;
    const completedIri = `${ROUTED_DAG}/node/completed`;
    const failedIri = `${ROUTED_DAG}/node/failed`;
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': ROUTED_DAG,
      '@type': 'DAG',
      'name': 'host-route-selection',
      'version': '1',
      'entrypoints': { 'main': placementIri },
      'nodes': [
        {
          '@id': placementIri,
          '@type': 'SingleNode',
          'name': 'route',
          'node': nodeIri,
          'outputs': { 'success': completedIri, 'error': failedIri },
        },
        { '@id': completedIri, '@type': 'TerminalNode', 'name': 'completed', 'outcome': 'completed' },
        { '@id': failedIri, '@type': 'TerminalNode', 'name': 'failed', 'outcome': 'failed' },
      ],
    };
    const node = TestBatchNode.of<RouteSelectionState, 'success' | 'error'>(nodeIri, ['success', 'error'], (batch) => {
      for (const item of batch) {
        item.state.successValue = `success:${item.id}`;
        item.state.errorValue = `error:${item.id}`;
        item.state.sharedValue = `shared:${item.id}`;
      }
      return new Map([
        ['success', batch.filter((_state, id) => id === 'success-item')],
        ['error', batch.filter((_state, id) => id === 'error-item')],
      ]);
    });
    return Promise.resolve({
      'bundle': { 'nodes': [node], 'dags': [dag] },
      'registryVersion': REGISTRY_VERSION,
      'restoreState': (dataset, runIri) => new RouteSelectionState(dataset, runIri),
    });
  }
}

class SnapshotCountingState extends NodeStateBase {
  static snapshotCount = 0;

  override snapshotTransientStateSelection(
    selection: Parameters<NodeStateBase['snapshotTransientStateSelection']>[0],
  ): ReturnType<NodeStateBase['snapshotTransientStateSelection']> {
    SnapshotCountingState.snapshotCount += 1;
    return super.snapshotTransientStateSelection(selection);
  }
}

class FailingResultChannel implements MessageChannelInterface {
  readonly #outbound: BridgeMessageType[] = [];
  readonly #waiters: ((message: BridgeMessageType) => void)[] = [];
  #handler: ((message: BridgeMessageType) => void) | null = null;
  resultSendAttempts = 0;

  send(message: BridgeMessageType): void {
    if (message.variant === 'result') {
      this.resultSendAttempts += 1;
      throw new Error('result send failed');
    }
    if (message.variant !== 'ready' && message.variant !== 'error') return;
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#outbound.push(message);
    else waiter(message);
  }

  onMessage(handler: (message: BridgeMessageType) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#handler = null;
  }

  receive(message: BridgeMessageType): void {
    const handler = this.#handler;
    if (handler === null) throw new Error('channel is not subscribed');
    handler(message);
  }

  nextOutbound(): Promise<BridgeMessageType> {
    const message = this.#outbound.shift();
    if (message !== undefined) return Promise.resolve(message);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }
}

class BundleAccessCountingRegistry implements RegistryModuleInterface {
  bundleAccessCount = 0;
  readonly batchSizes: number[] = [];

  constructor(
    readonly restoreState: RegistryBundleInterface['restoreState'] =
      (dataset, runIri) => new NodeStateBase(dataset, runIri),
  ) {}

  instantiate(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    const nodeIri = 'urn:noocodec:node:host-dispatcher-counting';
    const placementIri = `${COUNTING_DAG}/node/count`;
    const terminalIri = `${COUNTING_DAG}/node/end`;
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': COUNTING_DAG,
      '@type': 'DAG',
      'name': 'host-dispatcher-counting',
      'version': '1',
      'entrypoints': { 'main': placementIri },
      'nodes': [
        {
          '@id': placementIri,
          '@type': 'SingleNode',
          'name': 'count',
          'node': nodeIri,
          'outputs': { 'done': terminalIri },
        },
        { '@id': terminalIri, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const node = TestBatchNode.of<NodeStateBase, 'done'>(nodeIri, ['done'], (batch) => {
      this.batchSizes.push(batch.size);
      return new Map([['done', batch]]);
    });
    const bundle = { 'nodes': [node], 'dags': [dag] };
    const registry = this;
    return Promise.resolve({
      get 'bundle'() {
        registry.bundleAccessCount += 1;
        return bundle;
      },
      'registryVersion': REGISTRY_VERSION,
      'restoreState': this.restoreState,
    });
  }
}

after(async () => TestHostPair.cleanup());

class DagHostFixture {
  private constructor() {}

  /** Collect the next single message from a channel. */
  static nextMessage(parentSide: MessageChannelInterface): Promise<BridgeMessageType> {
    return new Promise((resolve) => {
      parentSide.onMessage((msg) => resolve(msg));
    });
  }

  /** Send init and collect the first reply. */
  static async sendInit(
    parentSide: MessageChannelInterface,
    registryModule: string = REGISTRY_MODULE_URL,
    registryVersion: string = REGISTRY_VERSION,
    graphStateTransferFormats: readonly GraphStateTransferFormatType[] = DEFAULT_GRAPH_STATE_TRANSFER_FORMATS,
    instrumentationPlacementPathDepth?: number,
  ): Promise<BridgeMessageType> {
    const reply = DagHostFixture.nextMessage(parentSide);
    parentSide.send({
      'variant': 'init',
      'registryModule': registryModule,
      'registryVersion': registryVersion,
      'servicesConfig': {},
      'graphStateTransferFormats': [...graphStateTransferFormats],
      ...(instrumentationPlacementPathDepth === undefined ? {} : { 'instrumentationPlacementPathDepth': instrumentationPlacementPathDepth }),
    });
    return reply;
  }
}

// ---------------------------------------------------------------------------
// Tests: init handshake
// ---------------------------------------------------------------------------

void describe('DagHost — init handshake', () => {
  void it('rejects empty and duplicate host format contracts', () => {
    const [emptyParent, emptyHost] = LoopbackChannel.pair();
    const [duplicateParent, duplicateHost] = LoopbackChannel.pair();
    try {
      assert.throws(
        () => new DagHost(emptyHost, { 'graphStateTransferFormats': [] }),
        /non-empty, duplicate-free graph-state transfer format enum array/u,
      );
      assert.throws(
        () => new DagHost(duplicateHost, {
          'graphStateTransferFormats': ['application/n-quads', 'application/n-quads'],
        }),
        /non-empty, duplicate-free graph-state transfer format enum array/u,
      );
    } finally {
      emptyParent.close();
      emptyHost.close();
      duplicateParent.close();
      duplicateHost.close();
    }
  });

  void it('replies ready with matching registryVersion on valid init', async () => {
    const { parentSide } = TestHostPair.create();
    const reply = await DagHostFixture.sendInit(parentSide);

    assert.strictEqual(reply.variant, 'ready');
    if (reply.variant === 'ready') {
      assert.strictEqual(reply.registryVersion, REGISTRY_VERSION);
      assert.deepEqual(reply.graphStateTransferFormats, ['application/n-quads']);
      assert.ok(Array.isArray(reply.capabilities));
      assert.ok(!reply.capabilities.includes('inline-nquads'));
    }
  });

  void it('advertises the host graph-state transfer formats during init', async () => {
    const { parentSide } = TestHostPair.create();
    const reply = await DagHostFixture.sendInit(
      parentSide,
      REGISTRY_MODULE_URL,
      REGISTRY_VERSION,
      ['application/n-quads'],
    );

    assert.strictEqual(reply.variant, 'ready');
    if (reply.variant === 'ready') {
      assert.deepEqual(reply.graphStateTransferFormats, ['application/n-quads']);
    }
  });

  void it('replies error with VERSION_MISMATCH when version does not match', async () => {
    const { parentSide } = TestHostPair.create();
    const reply = await DagHostFixture.sendInit(parentSide, REGISTRY_MODULE_URL, '99.0.0');

    assert.strictEqual(reply.variant, 'error');
    if (reply.variant === 'error') {
      assert.strictEqual(reply.code, 'VERSION_MISMATCH');
      assert.strictEqual(reply.recoverable, false);
      assert.strictEqual(reply.correlationId, null);
    }
  });

  void it('replies error when module cannot be resolved', async () => {
    const { parentSide } = TestHostPair.create();
    const reply = await DagHostFixture.sendInit(parentSide, '/nonexistent/module-does-not-exist.js');

    assert.strictEqual(reply.variant, 'error');
    if (reply.variant === 'error') {
      assert.strictEqual(reply.code, 'INIT_FAILED');
      assert.strictEqual(reply.recoverable, false);
    }
  });

  void it('replies error with INVALID_REGISTRY_MODULE for module without instantiate', async () => {
    const { parentSide } = TestHostPair.create();
    const reply = await DagHostFixture.sendInit(parentSide, INVALID_MODULE_URL);

    assert.strictEqual(reply.variant, 'error');
    if (reply.variant === 'error') {
      assert.ok(
        reply.code === 'INVALID_REGISTRY_MODULE' || reply.code === 'INIT_FAILED',
        `expected INVALID_REGISTRY_MODULE or INIT_FAILED, got ${reply.code}`,
      );
      assert.strictEqual(reply.recoverable, false);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: execute
// ---------------------------------------------------------------------------

void describe('DagHost — execute returns result', () => {
  void it('reads the dispatcher bundle once and isolates sequential requests', async () => {
    const registry = new BundleAccessCountingRegistry();
    const { parentSide } = TestHostPair.create(registry);

    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    const execute = async (correlationId: string, placementPath: readonly string[]): Promise<BridgeMessageType> => {
      const resultPromise = new Promise<BridgeMessageType>((resolve) => {
        parentSide.onMessage((message) => {
          if (message.variant === 'result' && message.response.correlationId === correlationId) resolve(message);
        });
      });
      const state = new NodeStateBase();
      parentSide.send({
        'variant': 'execute',
        'request': {
          'dagName': COUNTING_DAG,
          'placementPath': [...placementPath],
          'graphState': inlineTransferEntries([{ 'id': correlationId, state }]),
          'items': [{ 'id': correlationId, 'runIri': state.runIri }],
          'timeoutMs': 5000,
          correlationId,
          'responseState': FULL_RESPONSE_STATE,
        },
      });
      return resultPromise;
    };

    const first = await execute('req-dispatcher-first', ['first-parent']);
    const second = await execute('req-dispatcher-second', ['second-parent']);

    assert.strictEqual(first.variant, 'result');
    assert.strictEqual(second.variant, 'result');
    if (first.variant === 'result') assert.strictEqual(first.response.correlationId, 'req-dispatcher-first');
    if (second.variant === 'result') assert.strictEqual(second.response.correlationId, 'req-dispatcher-second');
    assert.strictEqual(registry.bundleAccessCount, 1, 'bundle access belongs to init, not execute');
  });

  void it('restores intended run identities and executes a multi-item request as one node batch', async () => {
    const factoryCalls: Array<{
      readonly dataset: GraphDatasetInterface;
      readonly runIri: string;
      readonly graphIris: readonly string[];
      readonly usesDataset: boolean;
    }> = [];
    const registry = new BundleAccessCountingRegistry((dataset, runIri) => {
      const state = new NodeStateBase(dataset, runIri);
      factoryCalls.push({
        dataset,
        runIri,
        'graphIris': [...new Set([...dataset.match({})].map((quad) => quad.graph.value))],
        'usesDataset': state.graphDataset === dataset,
      });
      return state;
    });
    const { parentSide } = TestHostPair.create(registry);
    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    const correlationId = 'req-dispatcher-batch';
    const entries = Array.from({ 'length': 5 }, (_unused, index) => {
      const id = `batch-item-${String(index)}`;
      return {
        id,
        'state': new NodeStateBase(new InMemoryGraphDataset(), `urn:dagonizer:run:${id}`),
      };
    });
    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((message) => {
        if (message.variant === 'result' && message.response.correlationId === correlationId) resolve(message);
      });
    });
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': COUNTING_DAG,
        'placementPath': ['batch-parent'],
        'graphState': inlineTransferEntries(entries),
        'items': entries.map((entry) => ({ 'id': entry.id, 'runIri': entry.state.runIri })),
        'timeoutMs': 5000,
        correlationId,
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.variant, 'result');
    if (result.variant === 'result') assert.strictEqual(result.response.items.length, 5);
    assert.deepEqual(registry.batchSizes, [5]);
    assert.deepEqual(
      factoryCalls.map((call) => call.runIri),
      entries.map((entry) => entry.state.runIri),
    );
    assert.equal(new Set(factoryCalls.map((call) => call.dataset)).size, entries.length);
    for (const call of factoryCalls) {
      assert.equal(call.usesDataset, true);
      assert.deepEqual(call.graphIris, [GraphStateTerms.runGraphIri(call.runIri)]);
    }
  });

  void it('runs a batch of one without retaining duplicate intermediates', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    // Collect messages until the batch result arrives.
    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': BODY_LAW2_DAG,   // mutator: sets value=99
        'placementPath': ['parent'],
        'graphState': inlineTransferEntries([{ 'id': 'req-exec-1', 'state': initialState }]),
        'items': [{ 'id': 'req-exec-1', 'runIri': initialState.runIri }],
        'timeoutMs': 5000,
        'correlationId': 'req-exec-1',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.variant, 'result');
    if (result.variant === 'result') {
      assert.strictEqual(result.response.correlationId, 'req-exec-1');
      assert.ok(Array.isArray(result.response.items), 'items must be an array');
      assert.strictEqual(result.response.items.length, 1, 'single-item request must produce 1 item result');
      const item0 = result.response.items[0];
      assert.ok(item0 !== undefined, 'items[0] must exist');
      assert.strictEqual(item0.terminalOutcome, 'completed');
      assert.ok(item0.intermediates.length > 0, 'single-item execution must retain item-local intermediates');
    }
  });

  void it('returns only N-Quads transfer payloads', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(parentSide, REGISTRY_MODULE_URL, REGISTRY_VERSION, ['application/n-quads']);
    assert.strictEqual(ready.variant, 'ready');

    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': BODY_LAW2_DAG,
        'placementPath': ['parent'],
        'graphState': inlineTransferEntries([{ 'id': 'req-exec-nquads', 'state': initialState }]),
        'items': [{ 'id': 'req-exec-nquads', 'runIri': initialState.runIri }],
        'timeoutMs': 5000,
        'correlationId': 'req-exec-nquads',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.variant, 'result');
    if (result.variant === 'result') {
      const item0 = result.response.items[0];
      assert.ok(item0 !== undefined);
      assert.strictEqual(result.response.graphState.transport, 'inline-nquads');
      assert.strictEqual(result.response.graphState.format, 'application/n-quads');
      assert.strictEqual(result.response.graphState.quadCount, 1);
      if (result.response.graphState.transport === 'inline-nquads') {
        assert.match(result.response.graphState.nquads, /transientStatePayload/);
      }
      const restored = await GraphStateTransferCodec.restoreTransient(result.response.graphState, result.response.items, null);
      assert.strictEqual(restored[0]?.state.domain['value'], 99);
    }
  });

  void it('applies each terminal route output selection to its own item in one graph transfer', async () => {
    const { parentSide } = TestHostPair.create(new RouteSelectionRegistry());
    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    const successState = new RouteSelectionState();
    const errorState = new RouteSelectionState();
    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((message) => {
        if (message.variant === 'result' && message.response.correlationId === 'req-route-selection') resolve(message);
      });
    });
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': ROUTED_DAG,
        'placementPath': ['route-parent'],
        'graphState': inlineTransferEntries([
          { 'id': 'success-item', 'state': successState },
          { 'id': 'error-item', 'state': errorState },
        ]),
        'items': [
          { 'id': 'success-item', 'runIri': successState.runIri },
          { 'id': 'error-item', 'runIri': errorState.runIri },
        ],
        'timeoutMs': 5000,
        'correlationId': 'req-route-selection',
        'responseState': {
          'defaultSelection': { 'mode': 'selection', 'domainPaths': [], 'metadataKeys': [] },
          'outputSelections': {
            'success': { 'mode': 'selection', 'domainPaths': ['successValue'], 'metadataKeys': [] },
            'error': { 'mode': 'selection', 'domainPaths': ['errorValue'], 'metadataKeys': [] },
          },
        },
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.variant, 'result');
    if (result.variant === 'result') {
      assert.strictEqual(result.response.graphState.transport, 'inline-nquads');
      assert.deepEqual(
        result.response.items.map((item) => [item.id, item.terminalOutcome]),
        [['success-item', 'completed'], ['error-item', 'failed']],
      );
      const restored = await GraphStateTransferCodec.restoreTransient(
        result.response.graphState,
        result.response.items,
        null,
      );
      const restoredById = new Map(restored.map((entry) => [entry.id, entry.state]));
      assert.deepEqual(restoredById.get('success-item')?.domain, { 'successValue': 'success:success-item' });
      assert.deepEqual(restoredById.get('error-item')?.domain, { 'errorValue': 'error:error-item' });
    }
  });

  void it('composes once when result send fails and emits one correlated outer error', async () => {
    SnapshotCountingState.snapshotCount = 0;
    const channel = new FailingResultChannel();
    const registry = new BundleAccessCountingRegistry(
      (dataset, runIri) => new SnapshotCountingState(dataset, runIri),
    );
    const host = new DagHost(channel, { registry });
    host.start();

    const readyPromise = channel.nextOutbound();
    channel.receive({
      'variant': 'init',
      'registryModule': REGISTRY_MODULE_URL,
      'registryVersion': REGISTRY_VERSION,
      'servicesConfig': {},
      'graphStateTransferFormats': ['application/n-quads'],
    });
    assert.strictEqual((await readyPromise).variant, 'ready');

    const initialState = new NodeStateBase();
    const errorPromise = channel.nextOutbound();
    channel.receive({
      'variant': 'execute',
      'request': {
        'dagName': COUNTING_DAG,
        'placementPath': ['send-failure-parent'],
        'graphState': inlineTransferEntries([{ 'id': 'send-failure-item', 'state': initialState }]),
        'items': [{ 'id': 'send-failure-item', 'runIri': initialState.runIri }],
        'timeoutMs': 5000,
        'correlationId': 'req-send-failure',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const error = await errorPromise;
    assert.strictEqual(channel.resultSendAttempts, 1);
    assert.strictEqual(SnapshotCountingState.snapshotCount, 1);
    assert.strictEqual(error.variant, 'error');
    if (error.variant === 'error') {
      assert.strictEqual(error.correlationId, 'req-send-failure');
      assert.strictEqual(error.code, 'INTERNAL_ERROR');
      assert.strictEqual(error.recoverable, false);
      assert.match(error.message, /result send failed/u);
    }
    channel.receive({ 'variant': 'shutdown' });
  });

  void it('drops worker instrumentation deeper than the requested placement-path depth', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(
      parentSide,
      REGISTRY_MODULE_URL,
      REGISTRY_VERSION,
      ['application/n-quads'],
      0,
    );
    assert.strictEqual(ready.variant, 'ready');

    const instrumentationMessages: BridgeMessageType[] = [];
    parentSide.onMessage((msg) => {
      if (msg.variant === 'instrumentationBatch') instrumentationMessages.push(msg);
    });

    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': BODY_LAW2_DAG,
        'placementPath': ['parent'],
        'graphState': inlineTransferEntries([{ 'id': 'req-exec-depth', 'state': initialState }]),
        'items': [{ 'id': 'req-exec-depth', 'runIri': initialState.runIri }],
        'timeoutMs': 5000,
        'correlationId': 'req-exec-depth',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.variant, 'result');
    assert.equal(instrumentationMessages.length, 0);
  });

  void it('does not emit live intermediate messages during execution', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    const intermediates: BridgeMessageType[] = [];
    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'intermediate') intermediates.push(msg);
        if (msg.variant === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': BODY_LAW1_DAG,   // recorder node → done
        'placementPath': ['host'],
        'graphState': inlineTransferEntries([{ 'id': 'req-exec-2', 'state': initialState }]),
        'items': [{ 'id': 'req-exec-2', 'runIri': initialState.runIri }],
        'timeoutMs': 5000,
        'correlationId': 'req-exec-2',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    await resultPromise;

    assert.strictEqual(intermediates.length, 0);
  });

  void it('returns result with items[0].terminalOutcome failed on execution error', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
    });

    // Request a non-existent DAG IRI — should fail gracefully.
    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': 'dag-does-not-exist',
        'placementPath': ['host'],
        'graphState': inlineTransferEntries([{ 'id': 'req-exec-fail', 'state': initialState }]),
        'items': [{ 'id': 'req-exec-fail', 'runIri': initialState.runIri }],
        'timeoutMs': 1000,
        'correlationId': 'req-exec-fail',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.variant, 'result');
    if (result.variant === 'result') {
      assert.ok(Array.isArray(result.response.items), 'items must be an array');
      const item0 = result.response.items[0];
      assert.ok(item0 !== undefined, 'items[0] must exist');
      assert.strictEqual(item0.terminalOutcome, 'failed');
      assert.ok(item0.errors.length > 0, 'must have at least 1 item-local error');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: abort
// ---------------------------------------------------------------------------

void describe('DagHost — abort', () => {
  void it('fires the AbortController; in-flight sleeper terminates before safety ceiling', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    const resultPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': BODY_LAW5_DAG,   // abort-sleeper: waits until aborted
        'placementPath': ['host'],
        'graphState': inlineTransferEntries([{ 'id': 'req-abort', 'state': initialState }]),
        'items': [{ 'id': 'req-abort', 'runIri': initialState.runIri }],
        'timeoutMs': null,
        'correlationId': 'req-abort',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    // Give the sleeper node time to begin.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    const start = Date.now();
    parentSide.send({
      'variant': 'abort',
      'correlationId': 'req-abort',
      'reason': 'abort',
    });

    const result = await resultPromise;
    const elapsed = Date.now() - start;

    assert.strictEqual(result.variant, 'result');
    // Abort must cause the result to arrive within 2s (safety ceiling is 5s).
    assert.ok(elapsed < 2000, `abort must resolve within 2s; got ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// Tests: shutdown
// ---------------------------------------------------------------------------

void describe('DagHost — shutdown', () => {
  void it('channel closes after shutdown message (no hang)', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    parentSide.send({ 'variant': 'shutdown' });

    // Give the async shutdown time to process.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // No assertion beyond no-throw / no-hang.
  });
});

// ---------------------------------------------------------------------------
// G8 — execute before init returns NOT_INITIALIZED error
// ---------------------------------------------------------------------------

void describe('DagHost — execute before init (G8)', () => {
  void it('replies error with NOT_INITIALIZED when execute arrives before init', async () => {
    const { parentSide } = TestHostPair.create();

    // DO NOT send init — send execute directly.
    const replyPromise = DagHostFixture.nextMessage(parentSide);

    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': BODY_LAW1_DAG,
        'placementPath': ['host'],
        'graphState': inlineTransferEntries([{ 'id': 'req-no-init', 'state': initialState }]),
        'items': [{ 'id': 'req-no-init', 'runIri': initialState.runIri }],
        'timeoutMs': null,
        'correlationId': 'req-no-init',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const reply = await replyPromise;

    assert.strictEqual(reply.variant, 'error', `expected error, got ${reply.variant}`);
    if (reply.variant === 'error') {
      assert.strictEqual(reply.code, 'NOT_INITIALIZED');
      assert.strictEqual(reply.recoverable, false);
      assert.strictEqual(reply.correlationId, 'req-no-init');
    }
  });

  void it('can init successfully after a NOT_INITIALIZED execute attempt', async () => {
    const { parentSide } = TestHostPair.create();

    // First: send execute without init — consume the error.
    const errorPromise = DagHostFixture.nextMessage(parentSide);
    const initialState = new NodeStateBase();
    parentSide.send({
      'variant': 'execute',
      'request': {
        'dagName': BODY_LAW1_DAG,
        'placementPath': ['host'],
        'graphState': inlineTransferEntries([{ 'id': 'req-pre-init-probe', 'state': initialState }]),
        'items': [{ 'id': 'req-pre-init-probe', 'runIri': initialState.runIri }],
        'timeoutMs': null,
        'correlationId': 'req-pre-init-probe',
        'responseState': FULL_RESPONSE_STATE,
      },
    });
    const errorReply = await errorPromise;
    assert.strictEqual(errorReply.variant, 'error');

    // Then: init should still succeed — the host is not in a terminal state.
    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready', `expected ready after recovery init, got ${ready.variant}`);
  });
});
