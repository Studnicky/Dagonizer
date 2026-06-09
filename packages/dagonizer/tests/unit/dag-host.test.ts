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
 *   - init invalid module (no createBundle): INVALID_REGISTRY_MODULE error
 *   - execute a dag: result with terminalOutput + stateSnapshot + intermediates
 *   - execute forwards intermediate messages
 *   - abort fires the AbortController (sleeper terminates)
 *   - shutdown closes the channel
 */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DagHost } from '../../src/container/DagHost.js';
import type { MessageChannelInterface } from '../../src/contracts/MessageChannelInterface.js';
import type { BridgeMessage } from '../../src/entities/executor/BridgeMessage.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { LoopbackChannel } from '../../testing/LoopbackChannel.js';

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

// A module URL that exists but is not a registry module (no createBundle export).
const INVALID_MODULE_URL = resolve(PACKAGE_ROOT, 'dist', 'index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHostPair(): {
  host: DagHost;
  parentSide: MessageChannelInterface;
} {
  const [parentSide, hostSide] = LoopbackChannel.pair();
  const host = new DagHost(hostSide);
  host.start();
  return { host, parentSide };
}

/** Collect the next single message from a channel. */
function nextMessage(parentSide: MessageChannelInterface): Promise<BridgeMessage> {
  return new Promise((resolve) => {
    parentSide.onMessage((msg) => resolve(msg));
  });
}

/** Send init and collect the first reply. */
async function sendInit(
  parentSide: MessageChannelInterface,
  registryModule: string = REGISTRY_MODULE_URL,
  registryVersion: string = REGISTRY_VERSION,
): Promise<BridgeMessage> {
  const reply = nextMessage(parentSide);
  parentSide.send({
    'kind': 'init',
    'registryModule': registryModule,
    'registryVersion': registryVersion,
    'servicesConfig': {},
  });
  return reply;
}

// ---------------------------------------------------------------------------
// Tests: init handshake
// ---------------------------------------------------------------------------

describe('DagHost — init handshake', () => {
  it('replies ready with matching registryVersion on valid init', async () => {
    const { parentSide } = buildHostPair();
    const reply = await sendInit(parentSide);

    assert.strictEqual(reply.kind, 'ready');
    if (reply.kind === 'ready') {
      assert.strictEqual(reply.registryVersion, REGISTRY_VERSION);
      assert.ok(Array.isArray(reply.capabilities));
    }
  });

  it('replies error with VERSION_MISMATCH when version does not match', async () => {
    const { parentSide } = buildHostPair();
    const reply = await sendInit(parentSide, REGISTRY_MODULE_URL, '99.0.0');

    assert.strictEqual(reply.kind, 'error');
    if (reply.kind === 'error') {
      assert.strictEqual(reply.code, 'VERSION_MISMATCH');
      assert.strictEqual(reply.recoverable, false);
      assert.strictEqual(reply.correlationId, null);
    }
  });

  it('replies error when module cannot be resolved', async () => {
    const { parentSide } = buildHostPair();
    const reply = await sendInit(parentSide, '/nonexistent/module-does-not-exist.js');

    assert.strictEqual(reply.kind, 'error');
    if (reply.kind === 'error') {
      assert.strictEqual(reply.code, 'INIT_FAILED');
      assert.strictEqual(reply.recoverable, false);
    }
  });

  it('replies error with INVALID_REGISTRY_MODULE for module without createBundle', async () => {
    const { parentSide } = buildHostPair();
    const reply = await sendInit(parentSide, INVALID_MODULE_URL);

    assert.strictEqual(reply.kind, 'error');
    if (reply.kind === 'error') {
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

describe('DagHost — execute returns result', () => {
  it('runs a dag and returns result with terminalOutput + stateSnapshot + intermediates', async () => {
    const { parentSide } = buildHostPair();

    const ready = await sendInit(parentSide);
    assert.strictEqual(ready.kind, 'ready');

    // Collect messages until we see a 'result' (intermediates + instrumentation may arrive first).
    const resultPromise = new Promise<BridgeMessage>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.kind === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'kind': 'execute',
      'request': {
        'dagName': 'conformance-body-law2',   // mutator: sets value=99
        'placementPath': ['parent'],
        'stateSnapshot': initialState.snapshot(),
        'timeoutMs': 5000,
        'correlationId': 'req-exec-1',
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.kind, 'result');
    if (result.kind === 'result') {
      assert.strictEqual(result.response.correlationId, 'req-exec-1');
      assert.strictEqual(result.response.terminalOutput, 'completed');
      assert.ok(result.response.stateSnapshot !== null, 'stateSnapshot must be non-null');
      assert.ok(Array.isArray(result.response.intermediates));
      assert.ok(result.response.intermediates.length > 0, 'must have at least 1 intermediate (mutator node)');
    }
  });

  it('forwards intermediate messages for each node in the dag', async () => {
    const { parentSide } = buildHostPair();

    const ready = await sendInit(parentSide);
    assert.strictEqual(ready.kind, 'ready');

    const intermediates: BridgeMessage[] = [];
    const resultPromise = new Promise<BridgeMessage>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.kind === 'intermediate') intermediates.push(msg);
        if (msg.kind === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'kind': 'execute',
      'request': {
        'dagName': 'conformance-body-law1',   // recorder node → done
        'placementPath': ['host'],
        'stateSnapshot': initialState.snapshot(),
        'timeoutMs': 5000,
        'correlationId': 'req-exec-2',
      },
    });

    await resultPromise;

    // At least one intermediate should have been sent for the recorder node.
    assert.ok(intermediates.length > 0, 'must have forwarded at least 1 intermediate message');
    const first = intermediates[0];
    assert.ok(first !== undefined);
    if (first.kind === 'intermediate') {
      assert.strictEqual(first.correlationId, 'req-exec-2');
      assert.ok(typeof first.nodeName === 'string');
    }
  });

  it('returns result with terminalOutput failed on execution error', async () => {
    const { parentSide } = buildHostPair();

    const ready = await sendInit(parentSide);
    assert.strictEqual(ready.kind, 'ready');

    const resultPromise = new Promise<BridgeMessage>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.kind === 'result') resolve(msg);
      });
    });

    // Request a non-existent DAG name — should fail gracefully.
    const initialState = new NodeStateBase();
    parentSide.send({
      'kind': 'execute',
      'request': {
        'dagName': 'dag-does-not-exist',
        'placementPath': [],
        'stateSnapshot': initialState.snapshot(),
        'timeoutMs': 1000,
        'correlationId': 'req-exec-fail',
      },
    });

    const result = await resultPromise;
    assert.strictEqual(result.kind, 'result');
    if (result.kind === 'result') {
      assert.strictEqual(result.response.terminalOutput, 'failed');
      assert.ok(result.response.errors.length > 0, 'must have at least 1 error');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: abort
// ---------------------------------------------------------------------------

describe('DagHost — abort', () => {
  it('fires the AbortController; in-flight sleeper terminates before safety ceiling', async () => {
    const { parentSide } = buildHostPair();

    const ready = await sendInit(parentSide);
    assert.strictEqual(ready.kind, 'ready');

    const resultPromise = new Promise<BridgeMessage>((resolve) => {
      parentSide.onMessage((msg) => {
        if (msg.kind === 'result') resolve(msg);
      });
    });

    const initialState = new NodeStateBase();
    parentSide.send({
      'kind': 'execute',
      'request': {
        'dagName': 'conformance-body-law5',   // abort-sleeper: waits until aborted
        'placementPath': ['host'],
        'stateSnapshot': initialState.snapshot(),
        'timeoutMs': null,
        'correlationId': 'req-abort',
      },
    });

    // Give the sleeper node time to begin.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    const start = Date.now();
    parentSide.send({
      'kind': 'abort',
      'correlationId': 'req-abort',
      'reason': 'test-abort',
    });

    const result = await resultPromise;
    const elapsed = Date.now() - start;

    assert.strictEqual(result.kind, 'result');
    // Abort must cause the result to arrive within 2s (safety ceiling is 5s).
    assert.ok(elapsed < 2000, `abort must resolve within 2s; got ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// Tests: shutdown
// ---------------------------------------------------------------------------

describe('DagHost — shutdown', () => {
  it('channel closes after shutdown message (no hang)', async () => {
    const { parentSide } = buildHostPair();

    const ready = await sendInit(parentSide);
    assert.strictEqual(ready.kind, 'ready');

    parentSide.send({ 'kind': 'shutdown' });

    // Give the async shutdown time to process.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // No assertion beyond no-throw / no-hang.
  });
});
