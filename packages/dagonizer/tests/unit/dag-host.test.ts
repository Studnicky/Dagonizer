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
 *   - execute a dag: result with items[0].terminalOutcome + items[0].snapshot + intermediates
 *   - execute forwards intermediate messages
 *   - abort fires the AbortController (sleeper terminates)
 *   - shutdown closes the channel
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CheckpointRestoreAdapter } from '../../src/checkpoint/Checkpoint.js';
import { DagHost } from '../../src/container/DagHost.js';
import { DEFAULT_GRAPH_STATE_TRANSFER_FORMATS } from '../../src/contracts/GraphStateTransferFormat.js';
import type { GraphStateTransferFormatType } from '../../src/contracts/GraphStateTransferFormat.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { RegistryBundleInterface } from '../../src/contracts/RegistryBundleInterface.js';
import type { RegistryModuleInterface } from '../../src/contracts/RegistryModuleInterface.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';
import { FULL_RESPONSE_STATE, inlineTransferEntries } from '../_support/GraphStateSupport.js';
import { TestBatchNode } from '../_support/TestBatchNode.js';

// ---------------------------------------------------------------------------
// Registry module URL for DagHost dynamic import.
// The ConformanceRegistry is compiled to dist-testing/; we reference the
// compiled .js file by resolving from this test file to the package root.
// In the compiled test tree, this file is at:
//   dist-test/tests/unit/dag-host.test.js
// The conformance registry is at:
//   dist-testing/ConformanceRegistry.js
// PACKAGE_ROOT = dist-test/tests/unit → 3 levels up → package root
// ---------------------------------------------------------------------------

// The compiled test file is at: dist-test/tests/unit/dag-host.test.js
// The conformance registry is at: dist-testing/ConformanceRegistry.js (package root)
const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const REGISTRY_MODULE_URL = resolve(PACKAGE_ROOT, 'dist-testing', 'ConformanceRegistry.js');
const REGISTRY_VERSION = '1.0.0';
const BODY_LAW1_DAG = 'urn:conformance:dag:conformance-body-law1';
const BODY_LAW2_DAG = 'urn:conformance:dag:conformance-body-law2';
const BODY_LAW5_DAG = 'urn:conformance:dag:conformance-body-law5';
const COUNTING_DAG = 'urn:noocodec:dag:host-dispatcher-counting';

// A module URL that exists but is not a registry module (no instantiate export).
const INVALID_MODULE_URL = resolve(PACKAGE_ROOT, 'dist', 'index.js');

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
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

class BundleAccessCountingRegistry implements RegistryModuleInterface {
  bundleAccessCount = 0;
  readonly batchSizes: number[] = [];

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
      'restoreState': CheckpointRestoreAdapter.wrap(() => new NodeStateBase()),
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

  void it('echoes graph-state transfer formats requested during init', async () => {
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

  void it('executes a multi-item request as one node batch', async () => {
    const registry = new BundleAccessCountingRegistry();
    const { parentSide } = TestHostPair.create(registry);
    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    const correlationId = 'req-dispatcher-batch';
    const entries = Array.from({ 'length': 5 }, (_unused, index) => ({
      'id': `batch-item-${String(index)}`,
      'state': new NodeStateBase(),
    }));
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
  });

  void it('runs a dag and returns result with items[0].terminalOutcome + items[0].graphState + intermediates', async () => {
    const { parentSide } = TestHostPair.create();

    const ready = await DagHostFixture.sendInit(parentSide);
    assert.strictEqual(ready.variant, 'ready');

    // Collect messages until we see a 'result' (intermediates + instrumentation may arrive first).
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
      assert.ok(Array.isArray(result.response.intermediates));
      assert.ok(result.response.intermediates.length > 0, 'must have at least 1 intermediate (mutator node)');
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
        'graphState': inlineTransferEntries([{ 'id': 'req-exec-jsonld', 'state': initialState }]),
        'items': [{ 'id': 'req-exec-jsonld', 'runIri': initialState.runIri }],
        'timeoutMs': 5000,
        'correlationId': 'req-exec-jsonld',
        'responseState': FULL_RESPONSE_STATE,
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.variant, 'result');
    if (result.variant === 'result') {
      const item0 = result.response.items[0];
      assert.ok(item0 !== undefined);
      assert.strictEqual(Object.hasOwn(item0, 'jsonLd'), false, 'response item must not include jsonLd in transfer payload');
    }
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
      assert.ok(result.response.errors.length > 0, 'must have at least 1 error');
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
