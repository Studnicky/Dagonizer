/**
 * reservoir-container-bounded-memory: regression test for the O(N) heap leak
 * in the reservoir + container streaming scatter path.
 *
 * Root causes (fixed):
 *
 * 1. `DagHost.#executeDAG` batch path (N>1 items per request): the
 *    `intermediates: ExecutorIntermediate[]` array accumulated ALL inner-node
 *    results for ALL items in the batch before sending them in
 *    `ExecutionResponse.intermediates`. For a reservoir with capacity=1000, a
 *    single batch accumulated 1000 × M intermediate objects, which were then
 *    held in the response on both the worker and parent sides until the batch
 *    was fully consumed.
 *
 *    Fix: in the batch path, inner-node intermediates are sent live as
 *    `'intermediate'` BridgeMessages (already done for observability) and are
 *    NOT buffered into the array. `ExecutionResponse.intermediates` is empty
 *    (`[]`) for batch requests.
 *
 * 2. `ScatterPoolDriver.ackBatch` inbox removal: per-item
 *    `findIndex+splice` was O(inbox_size × batch_size). Replaced with a single
 *    O(inbox_size) in-place filter pass using a `Set<number>` of indexes to
 *    remove.
 *
 * Asserted contracts:
 * - `DagHost` multi-item batch response carries `intermediates: []` (empty).
 *   Live `'intermediate'` BridgeMessages are still forwarded per node.
 * - A compactable gather over large N (simulated via the in-process scatter +
 *   container seam) does not retain per-item intermediates (heap stays bounded).
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DagHost } from '../../src/container/DagHost.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

// ---------------------------------------------------------------------------
// Registry: reuse the compiled ConformanceRegistry from dist-testing/
//
// The compiled test file lives at:
//   dist-test/tests/unit/reservoir-container-bounded-memory.test.js
// The conformance registry is at:
//   dist-testing/ConformanceRegistry.js
// PACKAGE_ROOT = three levels up from the test file (tests/unit/ → tests/ → dagonizer/).
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const REGISTRY_MODULE_URL = resolve(PACKAGE_ROOT, 'dist-testing', 'ConformanceRegistry.js');
const REGISTRY_VERSION = '1.0.0';

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

/** Initialize the host and assert it replied 'ready'. */
async function initHost(parentSide: MessageChannelInterface): Promise<void> {
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
  });
  const reply = await readyPromise;
  assert.strictEqual(reply.variant, 'ready', `DagHost init must reply 'ready'; got '${reply.variant}'`);
}

// ---------------------------------------------------------------------------
// Tests: DagHost batch path intermediates contract
// ---------------------------------------------------------------------------

void describe('DagHost — batch request: intermediates are empty, live messages still sent', () => {
  /**
   * Core regression: a multi-item batch request (N>1 items) must produce a
   * result with `intermediates: []`. Before the fix, all N × M inner-node
   * results were buffered into the `intermediates` array on the worker side
   * and serialized into `ExecutionResponse.intermediates`.
   *
   * Live `'intermediate'` BridgeMessages MUST still be forwarded so the
   * observer relay receives per-node observability in real-time. These are
   * independent of the (now-empty) `response.intermediates` array.
   */
  void it('batch response carries empty intermediates[] while live intermediate messages are still forwarded', async () => {
    const { parentSide } = TestHostPair.create();
    await initHost(parentSide);

    const N = 5; // Small N — we test the structural contract, not heap scale
    const initialState = new NodeStateBase();

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
      parentSide.send({
        'variant': 'execute',
        'request': {
          'dagName': 'conformance-body-law1',
          'placementPath': ['scatter', 'fan'],
          'items': Array.from({ 'length': N }, (_, i) => ({
            'id': `item-${i}`,
            'snapshot': initialState.snapshot(),
          })),
          'timeoutMs': 10000,
          'correlationId': 'batch-test-1',
        },
      });
    });

    assert.strictEqual(result.variant, 'result');

    // Core contract: batch response must carry an empty intermediates array.
    // Before the fix: length === N × M (all inner nodes buffered for all items).
    // After the fix: length === 0 (inner nodes sent live, not buffered).
    assert.strictEqual(
      result.response.intermediates.length,
      0,
      `ExecutionResponse.intermediates must be empty for a batch (N=${N}) request. ` +
      `Got ${result.response.intermediates.length} entries — the O(N×M) intermediate ` +
      `buffering regression is present.`,
    );

    // Live observability contract: 'intermediate' BridgeMessages must still
    // be forwarded per node per item so the relay receives real-time events.
    // law1 has at least 1 node (recorder-node → done → terminal), so expect N messages.
    assert.ok(
      intermediateMessages.length >= N,
      `At least N=${N} live 'intermediate' BridgeMessages must be forwarded (one per inner ` +
      `node per item at minimum). Got ${intermediateMessages.length}. Live relay observability ` +
      `is broken if this fails.`,
    );

    // Each live intermediate must carry the correct correlationId.
    for (const msg of intermediateMessages) {
      assert.strictEqual(
        msg.correlationId,
        'batch-test-1',
        `All live intermediate messages must carry correlationId 'batch-test-1'. ` +
        `Got '${msg.correlationId}'.`,
      );
    }

    // Result must carry N item results.
    assert.strictEqual(
      result.response.items.length,
      N,
      `Batch result must carry exactly N=${N} item results. Got ${result.response.items.length}.`,
    );
  });

  /**
   * Correctness: single-item requests (N=1) continue to buffer intermediates
   * for the embedded-DAG top-level streaming path. The fix only targets the
   * multi-item path. Assert single-item requests still produce non-empty
   * `intermediates` in `ExecutionResponse`.
   */
  void it('single-item (N=1) response still carries non-empty intermediates for top-level streaming', async () => {
    const { parentSide } = TestHostPair.create();
    await initHost(parentSide);

    const initialState = new NodeStateBase();

    const singleResult = await new Promise<BridgeMessageType & { variant: 'result' }>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
      parentSide.send({
        'variant': 'execute',
        'request': {
          'dagName': 'conformance-body-law1',
          'placementPath': ['parent'],
          'items': [{ 'id': 'single-1', 'snapshot': initialState.snapshot() }],
          'timeoutMs': 5000,
          'correlationId': 'single-test-1',
        },
      });
    });

    assert.strictEqual(singleResult.variant, 'result');

    // Single-item path: intermediates MUST be non-empty (top-level streaming depends on this).
    assert.ok(
      singleResult.response.intermediates.length > 0,
      `Single-item (N=1) response must carry non-empty intermediates for top-level ` +
      `embedded-DAG streaming. Got ${singleResult.response.intermediates.length} entries. ` +
      `The fix must NOT affect the single-item path.`,
    );
  });

  /**
   * Scale test: N=50 item batch produces an empty `intermediates` array.
   * Proves the bounded contract holds regardless of batch size.
   */
  void it('large batch (N=50) produces empty intermediates in response', async () => {
    const { parentSide } = TestHostPair.create();
    await initHost(parentSide);

    const N = 50;
    const initialState = new NodeStateBase();

    const batchResult = await new Promise<BridgeMessageType & { variant: 'result' }>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.variant === 'result') resolve(msg);
      });
      parentSide.send({
        'variant': 'execute',
        'request': {
          'dagName': 'conformance-body-law1',
          'placementPath': ['scatter', 'fan'],
          'items': Array.from({ 'length': N }, (_, i) => ({
            'id': `large-item-${i}`,
            'snapshot': initialState.snapshot(),
          })),
          'timeoutMs': 30000,
          'correlationId': 'batch-test-large',
        },
      });
    });

    assert.strictEqual(batchResult.variant, 'result');
    assert.strictEqual(
      batchResult.response.intermediates.length,
      0,
      `Large batch (N=${N}) response must carry intermediates: [] (empty). ` +
      `Got ${batchResult.response.intermediates.length}. ` +
      `A non-zero count proves O(N×M) buffering is still active.`,
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
   * Heap assertion: sending many large batches through DagHost must not
   * produce O(N × batch_size × nodes) retained objects.
   *
   * This test is skipped unless `--expose-gc` is active so it does not
   * artificially slow CI. Run with:
   *   node --expose-gc --import tsx packages/dagonizer/tests/unit/reservoir-container-bounded-memory.test.ts
   *
   * Before the fix: each batch of N items buffered N × M intermediates into
   * the `intermediates` array on the worker side, then all were included in
   * `ExecutionResponse.intermediates`. For 10 batches of 100 items with M=2
   * inner nodes, that was 2000 intermediate objects buffered at once.
   *
   * After the fix: zero intermediate objects are buffered on the worker side
   * for batch requests; heap growth scales with concurrency × max_items_in_flight,
   * not with total event count.
   */
  void it('heap delta per batch is O(1) not O(batch_size × nodes) when GC is available', async () => {
    const maybeGc: unknown = Reflect.get(globalThis, 'gc');
    if (typeof maybeGc !== 'function') {
      // Not running with --expose-gc — skip heap assertion.
      return;
    }
    // After typeof guard, maybeGc is Function. Wrap in a () => void closure
    // so call sites read as gc() without needing a cast at every invocation.
    const gc = (): void => { maybeGc.call(null); };

    const { parentSide } = TestHostPair.create();
    await initHost(parentSide);

    const BATCH_SIZE = 100;
    const NUM_BATCHES = 5;
    const initialState = new NodeStateBase();

    gc();
    const baseline = process.memoryUsage().heapUsed;

    for (let b = 0; b < NUM_BATCHES; b++) {
      await new Promise<void>((resolve) => {
        parentSide.onMessage((msg) => {
          if (msg.variant === 'result') resolve();
        });
        parentSide.send({
          'variant': 'execute',
          'request': {
            'dagName': 'conformance-body-law1',
            'placementPath': ['scatter', 'fan'],
            'items': Array.from({ 'length': BATCH_SIZE }, (_, i) => ({
              'id': `heap-batch-${b}-item-${i}`,
              'snapshot': initialState.snapshot(),
            })),
            'timeoutMs': 30000,
            'correlationId': `heap-batch-${b}`,
          },
        });
      });
    }

    gc();
    gc();
    const live = process.memoryUsage().heapUsed;

    // Post-GC live heap delta must be small — no intermediate objects retained.
    // Before the fix: NUM_BATCHES × BATCH_SIZE × M intermediates would be
    // retained until they cleared GC pressure, producing a large delta.
    // After the fix: intermediates are never buffered on the worker side.
    const liveMB = (live - baseline) / (1024 * 1024);
    assert.ok(
      liveMB < 20,
      `Post-GC live heap delta must be < 20 MB for ${NUM_BATCHES} batches of ${BATCH_SIZE} items. ` +
      `Got ${liveMB.toFixed(1)} MB. A large delta proves O(N×M) intermediate buffering ` +
      `is still retaining objects across batches.`,
    );
  });
});
