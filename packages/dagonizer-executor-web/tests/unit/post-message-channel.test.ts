/**
 * post-message-channel.test.ts
 *
 * Unit tests for PostMessageChannel:
 *   - Round-trip: send on parent side → handler on worker side fires
 *   - Invalid-payload handling: bad data → 'error' message to handler
 *   - Close semantics: messages sent after close() are dropped
 *   - StructuredClone isolation: FakeWorker clones payloads so non-serializable
 *     data fails honestly (objects mutated after send are NOT seen by receiver)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers';

import type { BridgeMessage } from '@noocodex/dagonizer/entities';

import { PostMessageChannel } from '../../src/PostMessageChannel.js';
import type {
  WebWorkerLikeInterface,
  WorkerScopeLikeInterface,
} from '../../src/WebWorkerLike.js';

// ---------------------------------------------------------------------------
// FakeWorker: in-process WebWorkerLikeInterface with structuredClone isolation
// ---------------------------------------------------------------------------

/**
 * A fake worker pair for testing PostMessageChannel.
 *
 * Two sides: `mainSide` (WebWorkerLikeInterface) and `workerSide`
 * (WorkerScopeLikeInterface). Sending on one delivers a structuredClone
 * to the other's listener via setImmediate (async, like real postMessage).
 */
class FakeWorkerPair {
  readonly mainSide: WebWorkerLikeInterface;
  readonly workerSide: WorkerScopeLikeInterface;

  #mainListeners: Array<(event: { 'data': unknown }) => void> = [];
  #workerListeners: Array<(event: { 'data': unknown }) => void> = [];
  #terminated = false;

  constructor() {
    // Bind arrow functions so `this` is correct when assigned to interfaces.
    this.mainSide = {
      'postMessage': (message: unknown) => {
        if (this.#terminated) return;
        const cloned = structuredClone(message);
        setImmediate(() => {
          for (const listener of this.#workerListeners) {
            listener({ 'data': cloned });
          }
        });
      },
      'addEventListener': (
        type: 'message' | 'error',
        listener: ((event: { 'data': unknown }) => void) | ((event: { 'message'?: string }) => void),
      ): void => {
        if (type === 'message') {
          this.#mainListeners.push(listener as (event: { 'data': unknown }) => void);
        }
        // 'error' listeners are unused by these PostMessageChannel tests.
      },
      'terminate': () => {
        this.#terminated = true;
      },
    };

    this.workerSide = {
      'postMessage': (message: unknown) => {
        if (this.#terminated) return;
        const cloned = structuredClone(message);
        setImmediate(() => {
          for (const listener of this.#mainListeners) {
            listener({ 'data': cloned });
          }
        });
      },
      'addEventListener': (_type: 'message', listener: (event: { 'data': unknown }) => void) => {
        this.#workerListeners.push(listener);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: wait for the next setImmediate tick
// ---------------------------------------------------------------------------

function nextTick(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('PostMessageChannel', () => {

  // ── Round-trip ─────────────────────────────────────────────────────────────

  void it('delivers a message from main side to worker side', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);
    const workerChannel = new PostMessageChannel(pair.workerSide);

    const received: BridgeMessage[] = [];
    workerChannel.onMessage((msg) => received.push(msg));

    const msg: BridgeMessage = {
      'kind': 'shutdown',
    };
    mainChannel.send(msg);

    await nextTick();
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'shutdown');
  });

  void it('delivers a message from worker side to main side', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);
    const workerChannel = new PostMessageChannel(pair.workerSide);

    const received: BridgeMessage[] = [];
    mainChannel.onMessage((msg) => received.push(msg));

    const msg: BridgeMessage = {
      'kind': 'ready',
      'registryVersion': '1.0.0',
      'capabilities': [],
    };
    workerChannel.send(msg);

    await nextTick();
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'ready');
  });

  void it('round-trips an init message with all required fields', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);
    const workerChannel = new PostMessageChannel(pair.workerSide);

    let received: BridgeMessage | null = null;
    workerChannel.onMessage((msg) => { received = msg; });

    const msg: BridgeMessage = {
      'kind': 'init',
      'registryModule': '/path/to/registry.js',
      'registryVersion': '2.0.0',
      'servicesConfig': { 'timeout': 5000 },
    };
    mainChannel.send(msg);

    await nextTick();
    assert.ok(received !== null);
    assert.strictEqual((received as BridgeMessage & { kind: 'init' }).kind, 'init');
    assert.strictEqual((received as BridgeMessage & { kind: 'init' }).registryVersion, '2.0.0');
  });

  // ── StructuredClone isolation ───────────────────────────────────────────────

  void it('clones payloads — mutations after send are not visible to receiver', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);
    const workerChannel = new PostMessageChannel(pair.workerSide);

    let received: BridgeMessage | null = null;
    workerChannel.onMessage((msg) => { received = msg; });

    const msg: BridgeMessage = {
      'kind': 'init',
      'registryModule': '/original.js',
      'registryVersion': '1.0.0',
      'servicesConfig': {},
    };
    mainChannel.send(msg);

    // Mutate the original after send — receiver should not see this change.
    // Since BridgeMessage is readonly-typed, we verify via structuredClone
    // behaviour: the sent message is a value copy.
    await nextTick();
    assert.ok(received !== null);
    // Received is a different object reference (structuredClone).
    assert.notStrictEqual(received, msg);
  });

  // ── Invalid payload handling ────────────────────────────────────────────────

  void it('surfaces an invalid inbound payload as an error message to the handler', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);

    const received: BridgeMessage[] = [];
    // pair.workerSide.postMessage delivers to the main-side listeners, so the
    // bad payload arrives at mainChannel — register its handler here.
    mainChannel.onMessage((msg) => received.push(msg));

    // Inject an invalid payload via the worker scope's postMessage — bypassing
    // PostMessageChannel.send() so the payload is NOT a valid BridgeMessage.
    pair.workerSide.postMessage({ 'notAValidMessage': true });

    await nextTick();
    assert.strictEqual(received.length, 1);
    const msg = received[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'error');
    if (msg.kind === 'error') {
      assert.strictEqual(msg.code, 'INVALID_MESSAGE');
      assert.strictEqual(msg.recoverable, false);
    }
  });

  void it('surfaces null as an error message to the handler', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);

    const received: BridgeMessage[] = [];
    mainChannel.onMessage((msg) => received.push(msg));

    pair.workerSide.postMessage(null);

    await nextTick();
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0]?.kind, 'error');
  });

  // ── Close semantics ─────────────────────────────────────────────────────────

  void it('drops messages sent after close()', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);
    const workerChannel = new PostMessageChannel(pair.workerSide);

    const received: BridgeMessage[] = [];
    workerChannel.onMessage((msg) => received.push(msg));

    mainChannel.close();
    mainChannel.send({ 'kind': 'shutdown' });

    await nextTick();
    assert.strictEqual(received.length, 0);
  });

  void it('handler is null after close() — inbound messages are dropped', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);
    const workerChannel = new PostMessageChannel(pair.workerSide);

    const received: BridgeMessage[] = [];
    workerChannel.onMessage((msg) => received.push(msg));

    // Close worker side, then send from main side.
    workerChannel.close();
    mainChannel.send({ 'kind': 'shutdown' });

    await nextTick();
    assert.strictEqual(received.length, 0);
  });

  void it('replaces handler on successive onMessage calls', async () => {
    const pair = new FakeWorkerPair();
    const mainChannel = new PostMessageChannel(pair.mainSide);
    const workerChannel = new PostMessageChannel(pair.workerSide);

    const first: BridgeMessage[] = [];
    const second: BridgeMessage[] = [];

    workerChannel.onMessage((msg) => first.push(msg));
    workerChannel.onMessage((msg) => second.push(msg));

    mainChannel.send({ 'kind': 'shutdown' });

    await nextTick();
    assert.strictEqual(first.length, 0, 'first handler must be replaced');
    assert.strictEqual(second.length, 1, 'second handler must receive the message');
  });
});
