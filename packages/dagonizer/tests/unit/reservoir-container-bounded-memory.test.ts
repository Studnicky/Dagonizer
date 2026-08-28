/**
 * Verifies bounded memory for reservoir-backed container execution.
 *
 * `DagHost` executes every payload through `executeBatch`. Each
 * `ExecutionResponse` carries item-local `intermediates` arrays, while worker
 * observability still flows through live instrumentation. Batch
 * acknowledgement and response handling keep retained heap bounded across
 * repeated large batches.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DagHost } from '../../src/container/DagHost.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import type { ExecutionRequestItemType } from '../../src/entities/executor/ExecutionRequest.js';
import type { GraphStateTransferType } from '../../src/entities/executor/GraphStateTransferSchema.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';
import { FULL_RESPONSE_STATE, inlineTransferEntries } from '../_support/GraphStateSupport.js';

// ---------------------------------------------------------------------------
// BatchFixture: builds a batch of N distinct clone states with unique run
// IRIs, the combined `graphState` transfer, and the lean request `items`
// array (`{ id, runIri }`) carried for each item.
// ---------------------------------------------------------------------------

class BatchFixture {
  private constructor() {}

  static of(ids: readonly string[]): { graphState: GraphStateTransferType; items: ExecutionRequestItemType[] } {
    const entries = ids.map((id) => {
      const state = new NodeStateBase(undefined, `urn:dagonizer:run:${id}`);
      return { id, state };
    });
    return {
      'graphState': inlineTransferEntries(entries),
      'items': entries.map((entry) => ({ 'id': entry.id, 'runIri': entry.state.runIri })),
    };
  }
}

// ---------------------------------------------------------------------------
// Registry: reuse the compiled ConformanceRegistry from dist-testing/
//
// Package export resolution is invariant between source and compiled tests.
// ---------------------------------------------------------------------------

const REGISTRY_MODULE_URL = fileURLToPath(new URL(
  'ConformanceRegistry.js',
  import.meta.resolve('@studnicky/dagonizer/testing'),
));
const REGISTRY_VERSION = '1.0.0';
const BODY_LAW1_DAG = 'urn:conformance:dag:conformance-body-law1';
const RUNNER_LAW1_DAG = 'urn:conformance:dag:conformance-runner-law1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TestHostPair {
  private constructor() {}
  static create(): { host: DagHost; parentSide: MessageChannelInterface } {
    const [parentSide, hostSide] = LoopbackChannel.pair();
    const host = new DagHost(hostSide);
    host.start();
    return { host, parentSide };
  }
}

class HostSetup {
  private constructor() {}

  /** Initialize the host and assert it replied 'ready'. */
  static async init(parentSide: MessageChannelInterface): Promise<void> {
    const readyPromise = new Promise<BridgeMessageType>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'ready' || msg.variant === 'error') resolve(msg);
      });
    });
    parentSide.send({
      'variant': 'init',
      'registryModule': REGISTRY_MODULE_URL,
      'registryVersion': REGISTRY_VERSION,
      'servicesConfig': {},
      'graphStateTransferFormats': ['application/n-quads'],
    });
    const reply = await readyPromise;
    assert.strictEqual(reply.variant, 'ready', `DagHost init must reply 'ready'; got '${reply.variant}'`);
  }
}

// ---------------------------------------------------------------------------
// Tests: DagHost executeBatch intermediates contract
// ---------------------------------------------------------------------------

void describe('DagHost — executeBatch responses carry item-local intermediates only', () => {
  /**
   * Multi-item execution returns every item with an item-local intermediates
   * array and emits no live intermediate bridge messages.
   */
  void it('batch response carries item-local intermediates and emits no live intermediate messages', async () => {
    const { parentSide } = TestHostPair.create();
    await HostSetup.init(parentSide);

    const N = 5; // Small N — we test the structural contract, not heap scale

    const { result, intermediateMessages } = await new Promise<{
      result: BridgeMessageType & { variant: 'result' };
      intermediateMessages: (BridgeMessageType & { variant: 'intermediate' })[];
    }>((resolve) => {
      const intermediateMessages: (BridgeMessageType & { variant: 'intermediate' })[] = [];
      parentSide.onMessage((msg) => {
        if (msg.variant === 'intermediate') intermediateMessages.push(msg);
        if (msg.variant === 'result') {
          resolve({ 'result': msg, intermediateMessages });
        }
      });
      // Send N items in a single batch request.
      const batch = BatchFixture.of(Array.from({ 'length': N }, (_, i) => `item-${i}`));
      parentSide.send({
        'variant': 'execute',
        'request': {
          'dagName': BODY_LAW1_DAG,
          'placementPath': ['scatter', 'fan'],
          'graphState': batch.graphState,
          'items': batch.items,
          'timeoutMs': 10000,
          'correlationId': 'batch-test-1',
          'responseState': FULL_RESPONSE_STATE,
        },
      });
    });

    assert.strictEqual(result.variant, 'result');

    const retainedIntermediateCount = result.response.items.reduce(
      (sum, item) => sum + item.intermediates.length,
      0,
    );
    assert.ok(
      retainedIntermediateCount > 0,
      'batch response must preserve at least one item-local intermediate',
    );

    assert.strictEqual(intermediateMessages.length, 0);

    // Result must carry N item results.
    assert.strictEqual(
      result.response.items.length,
      N,
      `Batch result must carry exactly N=${N} item results. Got ${result.response.items.length}.`,
    );
  });

  /**
   * Single-item execution preserves the same item-local intermediates contract
   * as every other payload size.
   */
  void it('single-item (N=1) response carries item-local intermediates', async () => {
    const { parentSide } = TestHostPair.create();
    await HostSetup.init(parentSide);

    const single = BatchFixture.of(['single-1']);

    const singleResult = await new Promise<BridgeMessageType & { variant: 'result' }>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
      parentSide.send({
        'variant': 'execute',
        'request': {
          'dagName': RUNNER_LAW1_DAG,
          'placementPath': ['run-child'],
          'graphState': single.graphState,
          'items': single.items,
          'timeoutMs': 5000,
          'correlationId': 'single-test-1',
          'responseState': FULL_RESPONSE_STATE,
        },
      });
    });

    assert.strictEqual(singleResult.variant, 'result');

    const item0 = singleResult.response.items[0];
    assert.ok(item0 !== undefined, 'single-item response must carry one item result');
    assert.ok(item0.intermediates.length > 0, 'single-item response must preserve item-local intermediates');
  });

  /**
   * Scale test: N=50 item batch still returns item-local intermediates.
   * The bounded response contract holds for a larger payload.
   */
  void it('large batch (N=50) preserves item-local intermediates in response', async () => {
    const { parentSide } = TestHostPair.create();
    await HostSetup.init(parentSide);

    const N = 50;

    const batchResult = await new Promise<BridgeMessageType & { variant: 'result' }>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
      const batch = BatchFixture.of(Array.from({ 'length': N }, (_, i) => `large-item-${i}`));
      parentSide.send({
        'variant': 'execute',
        'request': {
          'dagName': BODY_LAW1_DAG,
          'placementPath': ['scatter', 'fan'],
          'graphState': batch.graphState,
          'items': batch.items,
          'timeoutMs': 30000,
          'correlationId': 'batch-test-large',
          'responseState': FULL_RESPONSE_STATE,
        },
      });
    });

    assert.strictEqual(batchResult.variant, 'result');
    const retainedIntermediateCount = batchResult.response.items.reduce(
      (sum, item) => sum + item.intermediates.length,
      0,
    );
    assert.ok(
      retainedIntermediateCount > 0,
      'large batch response must preserve item-local intermediates',
    );

    assert.strictEqual(
      batchResult.response.items.length,
      N,
      `Large batch must produce exactly N=${N} item results. Got ${batchResult.response.items.length}.`,
    );
  });
});

// ---------------------------------------------------------------------------
// Heap regression: GC-gated assertion
// ---------------------------------------------------------------------------

void describe('DagHost — batch response intermediates heap (GC-gated)', () => {
  /**
   * Sending many large batches through DagHost keeps post-GC live heap bounded.
   *
   * This test is skipped unless `--expose-gc` is active so it does not
   * artificially slow CI. Run with:
   *   node --expose-gc --import tsx packages/dagonizer/tests/unit/reservoir-container-bounded-memory.test.ts
   *
   * Responses retain item-local intermediate node results, so heap growth is
   * bounded by active execution state rather than an obsolete response-global
   * buffer.
   */
  void it('heap delta per batch is O(1) not O(batch_size × nodes) when GC is available', async () => {
    const maybeGc: unknown = Reflect.get(globalThis, 'gc');
    if (typeof maybeGc !== 'function') {
      // Not running with --expose-gc — skip heap assertion.
      return;
    }
    // The function guard permits direct invocation through a small local closure.
    const gc = (): void => { maybeGc.call(null); };

    const { parentSide } = TestHostPair.create();
    await HostSetup.init(parentSide);

    const BATCH_SIZE = 100;
    const NUM_BATCHES = 5;

    gc();
    const baseline = process.memoryUsage().heapUsed;

    for (let b = 0; b < NUM_BATCHES; b++) {
      await new Promise<void>((resolve) => {
        parentSide.onMessage((msg) => {
          if (msg.variant === 'result') resolve();
        });
        const batch = BatchFixture.of(Array.from({ 'length': BATCH_SIZE }, (_, i) => `heap-batch-${b}-item-${i}`));
        parentSide.send({
          'variant': 'execute',
          'request': {
            'dagName': BODY_LAW1_DAG,
            'placementPath': ['scatter', 'fan'],
            'graphState': batch.graphState,
            'items': batch.items,
            'timeoutMs': 30000,
            'correlationId': `heap-batch-${b}`,
            'responseState': FULL_RESPONSE_STATE,
          },
        });
      });
    }

    gc();
    gc();
    const live = process.memoryUsage().heapUsed;

    // Post-GC live heap remains bounded because responses retain no intermediates.
    const liveMB = (live - baseline) / (1024 * 1024);
    assert.ok(
      liveMB < 20,
      `Post-GC live heap delta must be < 20 MB for ${NUM_BATCHES} batches of ${BATCH_SIZE} items. ` +
      `Got ${liveMB.toFixed(1)} MB. A large delta proves O(N×M) intermediate buffering ` +
      `is still retaining objects across batches.`,
    );
  });
});
