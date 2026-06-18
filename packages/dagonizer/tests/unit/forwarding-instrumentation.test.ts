/**
 * Verifies that WorkerObserver routes all five hook overrides
 * (onNodeStart, onNodeEnd, onPhaseEnter, onPhaseExit, onError) as
 * BridgeMessage { kind: 'instrumentation' } messages over its channel. Also
 * confirms onFlowStart and onFlowEnd are suppressed (no message sent).
 *
 * Coverage target: G6.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WorkerObserver } from '../../src/container/WorkerObserver.js';
import type { BridgeMessage } from '../../src/entities/executor/BridgeMessage.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// Minimal channel that collects sent messages.
class CollectingChannel {
  readonly sent: BridgeMessage[] = [];
  send(msg: BridgeMessage): void { this.sent.push(msg); }
  onMessage(_handler: (msg: BridgeMessage) => void): void { /* no-op */ }
  close(): void { /* no-op */ }
}

const CORR = 'corr-test';
const BASE = ['parent-embed'];
const state = new NodeStateBase();

// Subclass exposes WorkerObserver's protected hooks so a test can fire each
// hook directly and inspect the BridgeMessage the observer sends.
class ExposedObserver extends WorkerObserver<NodeStateBase> {
  callNodeStart(nodeName: string, s: NodeStateBase, path: readonly string[]): void { this.onNodeStart(nodeName, s, path); }
  callNodeEnd(nodeName: string, output: string | null, s: NodeStateBase, path: readonly string[]): void { this.onNodeEnd(nodeName, output, s, path); }
  callPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, s: NodeStateBase, path: readonly string[]): void { this.onPhaseEnter(dagName, phase, placementName, s, path); }
  callPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, s: NodeStateBase, path: readonly string[]): void { this.onPhaseExit(dagName, phase, placementName, s, path); }
  callError(nodeName: string, error: Error, s: NodeStateBase, path: readonly string[]): void { this.onError(nodeName, error, s, path); }
  callFlowStart(dagName: string, s: NodeStateBase): void { this.onFlowStart(dagName, s); }
}

void describe('WorkerObserver — all-five-hook routing (G6)', () => {
  void it('forwards every overridden hook as instrumentation BridgeMessage with correct fields, suppresses onFlowStart, and prepends basePath', () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, CORR, BASE, {});

    // nodeStart: one message, all fields populated, basePath composed with the
    // per-call inner path.
    exposed.callNodeStart('my-node', state, ['child']);
    assert.strictEqual(ch.sent.length, 1);
    const startMsg = ch.sent[0];
    assert.ok(startMsg !== undefined);
    assert.strictEqual(startMsg.kind, 'instrumentation');
    if (startMsg.kind === 'instrumentation') {
      assert.strictEqual(startMsg.hook, 'nodeStart');
      assert.strictEqual(startMsg.correlationId, CORR);
      assert.strictEqual(startMsg.nodeName, 'my-node');
      assert.strictEqual(startMsg.phase, '');
      assert.strictEqual(startMsg.output, null);
      assert.deepStrictEqual(startMsg.placementPath, ['parent-embed', 'child']);
    }

    // nodeEnd: carries the output token and the composed path.
    ch.sent.length = 0;
    exposed.callNodeEnd('my-node', 'success', state, ['child']);
    assert.strictEqual(ch.sent.length, 1);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'nodeEnd');
      assert.strictEqual(ch.sent[0].output, 'success');
      assert.deepStrictEqual(ch.sent[0].placementPath, ['parent-embed', 'child']);
    }

    // phaseEnter: phase token surfaces and the placement name becomes nodeName.
    ch.sent.length = 0;
    exposed.callPhaseEnter('dag', 'pre', 'placement', state, []);
    assert.strictEqual(ch.sent.length, 1);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'phaseEnter');
      assert.strictEqual(ch.sent[0].phase, 'pre');
      assert.strictEqual(ch.sent[0].nodeName, 'placement');
    }

    // phaseExit: post phase token surfaces.
    ch.sent.length = 0;
    exposed.callPhaseExit('dag', 'post', 'placement', state, []);
    assert.strictEqual(ch.sent.length, 1);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'phaseExit');
      assert.strictEqual(ch.sent[0].phase, 'post');
    }

    // error: error message forwarded and path composed with the inner path.
    ch.sent.length = 0;
    exposed.callError('node', new Error('test error'), state, ['inner']);
    assert.strictEqual(ch.sent.length, 1);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'error');
      assert.strictEqual(ch.sent[0].message, 'test error');
      assert.deepStrictEqual(ch.sent[0].placementPath, ['parent-embed', 'inner']);
    }

    // flowStart is suppressed — WorkerObserver does not override it; base Dagonizer's
    // protected onFlowStart is a no-op, so no instrumentation BridgeMessage is sent.
    ch.sent.length = 0;
    exposed.callFlowStart('dag', state);
    assert.strictEqual(ch.sent.length, 0, 'onFlowStart must not send any message');
  });

  void it('prepends a multi-element basePath to the per-call placement path', () => {
    const ch = new CollectingChannel();
    const exposed = new ExposedObserver(ch, CORR, ['a', 'b'], {});
    exposed.callNodeStart('n', state, ['c']);

    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.deepStrictEqual(msg.placementPath, ['a', 'b', 'c']);
    }
  });
});
