/**
 * Verifies WorkerObserver's per-flush instrumentation-event dedup
 * (`coalesceInstrumentation`, default `true`).
 *
 * Inner scatter-clone nodes report a STATIC placementPath (no per-clone
 * index — see BodyExecutor.ts / ScatterDispatch.ts), so thousands of clones
 * passing through the same static node in one microtask flush window
 * produce identical instrumentation events. Dedup collapses those to a
 * single first-occurrence item; distinct outputs and distinct hooks are
 * never merged.
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

const CORR = 'corr-coalesce-test';
const BASE = ['embed'];
const state = new NodeStateBase();

// Subclass exposes WorkerObserver's protected hooks so a test can fire each
// hook directly and inspect the BridgeMessageType the observer sends.
class ExposedObserver extends WorkerObserver<NodeStateBase> {
  callNodeStart(nodeName: string, s: NodeStateBase, path: readonly string[]): void { this.onNodeStart(nodeName, s, path); }
  callNodeEnd(nodeName: string, output: string | null, s: NodeStateBase, path: readonly string[]): void { this.onNodeEnd(nodeName, output, s, path); }
}

void describe('WorkerObserver — instrumentation-event coalescing', () => {
  void it('collapses N identical events in one flush window to a single item, preserving first-occurrence order', async () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, CORR, BASE, {});

    // 1000 scatter clones passing through the same static node in the same
    // microtask window all report the identical (hook, phase, dagName,
    // nodeName, output, placementPath) tuple.
    for (let i = 0; i < 1000; i += 1) {
      exposed.callNodeStart('scatter-body-node', state, ['scatter', 'body']);
    }
    await Promise.resolve();

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.variant, 'instrumentationBatch');
    if (msg.variant === 'instrumentationBatch') {
      assert.strictEqual(msg.items.length, 1, 'identical events collapse to one item');
      assert.strictEqual(msg.items[0]?.nodeName, 'scatter-body-node');
    }
  });

  void it('preserves distinct outputs as separate items (nodeEnd→success vs nodeEnd→error)', async () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, CORR, BASE, {});

    for (let i = 0; i < 500; i += 1) {
      exposed.callNodeEnd('scatter-body-node', 'success', state, ['scatter', 'body']);
    }
    for (let i = 0; i < 500; i += 1) {
      exposed.callNodeEnd('scatter-body-node', 'error', state, ['scatter', 'body']);
    }
    await Promise.resolve();

    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.variant, 'instrumentationBatch');
    if (msg.variant === 'instrumentationBatch') {
      assert.strictEqual(msg.items.length, 2, 'distinct outputs survive as separate items');
      const outputs = msg.items.map((item) => item.output);
      assert.deepStrictEqual(outputs, ['success', 'error'], 'first-occurrence order is preserved');
    }
  });

  void it('emits a nodeStart and nodeEnd for the same path as two distinct items (different hooks, not merged)', async () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, CORR, BASE, {});

    exposed.callNodeStart('scatter-body-node', state, ['scatter', 'body']);
    exposed.callNodeEnd('scatter-body-node', 'success', state, ['scatter', 'body']);
    await Promise.resolve();

    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.variant, 'instrumentationBatch');
    if (msg.variant === 'instrumentationBatch') {
      assert.strictEqual(msg.items.length, 2);
      assert.deepStrictEqual(msg.items.map((item) => item.hook), ['nodeStart', 'nodeEnd']);
    }
  });

  void it('emits every raw event with coalesceInstrumentation: false', async () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, CORR, BASE, {}, { 'coalesceInstrumentation': false });

    for (let i = 0; i < 25; i += 1) {
      exposed.callNodeStart('scatter-body-node', state, ['scatter', 'body']);
    }
    await Promise.resolve();

    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.variant, 'instrumentationBatch');
    if (msg.variant === 'instrumentationBatch') {
      assert.strictEqual(msg.items.length, 25, 'opt-out emits every raw event, no dedup');
    }
  });
});
