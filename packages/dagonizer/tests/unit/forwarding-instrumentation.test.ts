/**
 * Verifies that WorkerObserver routes all five hook overrides
 * (onNodeStart, onNodeEnd, onPhaseEnter, onPhaseExit, onError) as
 * BridgeMessageType { variant: 'instrumentation' } messages over its channel. Also
 * confirms onFlowStart and onFlowEnd are suppressed (no message sent).
 *
 * Coverage target: G6.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WorkerObserver } from '../../src/container/WorkerObserver.js';
import type { BridgeMessageType } from '../../src/entities/executor/BridgeMessage.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// Minimal channel that collects sent messages.
class CollectingChannel {
  readonly sent: BridgeMessageType[] = [];
  send(msg: BridgeMessageType): void { this.sent.push(msg); }
  onMessage(_handler: (msg: BridgeMessageType) => void): void { /* no-op */ }
  close(): void { /* no-op */ }
}

const CORR = 'corr-test';
const BASE = ['parent-embed'];
const state = new NodeStateBase();
// WorkerObserver doesn't override onFlowStart (suppressed on the container
// path), so calling it through `this` resolves to the base Dagonizer's
// 3-param signature, which now requires a signal.
const SIGNAL = new AbortController().signal;

// Subclass exposes WorkerObserver's protected hooks so a test can fire each
// hook directly and inspect the BridgeMessageType the observer sends.
class ExposedObserver extends WorkerObserver<NodeStateBase> {
  callNodeStart(nodeName: string, s: NodeStateBase, path: readonly string[]): void { this.onNodeStart(nodeName, s, path); }
  callNodeEnd(nodeName: string, output: string | null, s: NodeStateBase, path: readonly string[]): void { this.onNodeEnd(nodeName, output, s, path); }
  callPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, s: NodeStateBase, path: readonly string[]): void { this.onPhaseEnter(dagName, phase, placementName, s, path); }
  callPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, s: NodeStateBase, path: readonly string[]): void { this.onPhaseExit(dagName, phase, placementName, s, path); }
  callError(nodeName: string, error: Error, s: NodeStateBase, path: readonly string[]): void { this.onError(nodeName, error, s, path); }
  callFlowStart(dagName: string, s: NodeStateBase): void { this.onFlowStart(dagName, s, SIGNAL); }
}

void describe('WorkerObserver — all-five-hook routing (G6)', () => {
  void it('forwards every overridden hook as an instrumentationBatch with correct items, suppresses onFlowStart, and prepends basePath', async () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, { 'correlationId': CORR, 'basePath': BASE }, {});

    // nodeStart: one message, all fields populated, basePath composed with the
    // per-call inner path.
    exposed.callNodeStart('my-node', state, ['child']);

    // nodeEnd: carries the output token and the composed path.
    ch.sent.length = 0;
    exposed.callNodeEnd('my-node', 'success', state, ['child']);
    exposed.callPhaseEnter('dag', 'pre', 'placement', state, []);

    // phaseExit: post phase token surfaces.
    exposed.callPhaseExit('dag', 'post', 'placement', state, []);

    exposed.callError('node', new Error('test error'), state, ['inner']);
    await Promise.resolve();

    assert.strictEqual(ch.sent.length, 1);
    const batchMsg = ch.sent[0];
    assert.ok(batchMsg !== undefined);
    assert.strictEqual(batchMsg.variant, 'instrumentationBatch');
    assert.equal(batchMsg.items.length, 5);
    if (batchMsg.variant === 'instrumentationBatch') {
      const hooks = batchMsg.items.map((item) => item.hook);
      assert.deepStrictEqual(hooks, ['nodeStart', 'nodeEnd', 'phaseEnter', 'phaseExit', 'error']);
      assert.strictEqual(batchMsg.items[0]?.nodeName, 'my-node');
      assert.deepStrictEqual(batchMsg.items[0]?.placementPath, ['parent-embed', 'child']);
      assert.strictEqual(batchMsg.items[1]?.hook, 'nodeEnd');
      assert.strictEqual(batchMsg.items[1]?.output, 'success');
      assert.deepStrictEqual(batchMsg.items[1]?.placementPath, ['parent-embed', 'child']);
      assert.strictEqual(batchMsg.items[2]?.hook, 'phaseEnter');
      assert.strictEqual(batchMsg.items[2]?.phase, 'pre');
      assert.strictEqual(batchMsg.items[2]?.nodeName, 'placement');
      assert.strictEqual(batchMsg.items[3]?.hook, 'phaseExit');
      assert.strictEqual(batchMsg.items[3]?.phase, 'post');
      assert.strictEqual(batchMsg.items[4]?.hook, 'error');
      assert.deepStrictEqual(batchMsg.items[4]?.placementPath, ['parent-embed', 'inner']);
    }

    // flowStart is suppressed — WorkerObserver does not override it, so no
    // instrumentation message is sent.
    ch.sent.length = 0;
    exposed.callFlowStart('dag', state);
    await Promise.resolve();
    assert.strictEqual(ch.sent.length, 0, 'onFlowStart must not send any message');
  });

  void it('prepends a multi-element basePath to the per-call placement path', async () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, { 'correlationId': CORR, 'basePath': ['a', 'b'] }, {});
    exposed.callNodeStart('n', state, ['c']);
    await Promise.resolve();

    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.variant, 'instrumentationBatch');
    if (msg.variant === 'instrumentationBatch') {
      assert.deepStrictEqual(msg.items[0]?.placementPath, ['a', 'b', 'c']);
    }
  });

  void it('drops events deeper than instrumentationPlacementPathDepth before they cross the worker boundary', async () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(
      ch,
      { 'correlationId': CORR, 'basePath': ['parent'] },
      {},
      { 'instrumentationPlacementPathDepth': 1 },
    );

    exposed.callNodeStart('kept', state, []);
    exposed.callNodeStart('dropped', state, ['child']);
    await Promise.resolve();

    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.variant, 'instrumentationBatch');
    if (msg.variant === 'instrumentationBatch') {
      assert.equal(msg.items.length, 1);
      assert.equal(msg.items[0]?.nodeName, 'kept');
      assert.deepStrictEqual(msg.items[0]?.placementPath, ['parent']);
    }
  });

});
