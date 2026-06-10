/**
 * worker-observer.test.ts (formerly forwarding-instrumentation.test.ts)
 *
 * Verifies that WorkerObserver routes all six hook overrides
 * (onNodeStart, onNodeEnd, onPhaseEnter, onPhaseExit, onContractWarning,
 * onError) as BridgeMessage { kind: 'instrumentation' } messages over its
 * channel. Also confirms onFlowStart and onFlowEnd are suppressed (no
 * message sent).
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

void describe('WorkerObserver — all-six-hook routing (G6)', () => {
  void it('onNodeStart forwards as instrumentation with hook=nodeStart and composed path', () => {
    const ch = new CollectingChannel();
    // Test the hook firing path via a subclass that exposes the protected methods.
    class ExposedObserver extends WorkerObserver<NodeStateBase> {
      callNodeStart(nodeName: string, s: NodeStateBase, path: readonly string[]): void {
        this.onNodeStart(nodeName, s, path);
      }
      callNodeEnd(nodeName: string, output: string | null, s: NodeStateBase, path: readonly string[]): void {
        this.onNodeEnd(nodeName, output, s, path);
      }
      callPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, s: NodeStateBase, path: readonly string[]): void {
        this.onPhaseEnter(dagName, phase, placementName, s, path);
      }
      callPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, s: NodeStateBase, path: readonly string[]): void {
        this.onPhaseExit(dagName, phase, placementName, s, path);
      }
      callError(nodeName: string, error: Error, s: NodeStateBase, path: readonly string[]): void {
        this.onError(nodeName, error, s, path);
      }
      callContractWarning(message: string): void {
        this.onContractWarning(message);
      }
      callFlowStart(dagName: string, s: NodeStateBase): void {
        this.onFlowStart(dagName, s);
      }
    }
    const exposed = new ExposedObserver(ch, CORR, BASE, {});
    exposed.callNodeStart('my-node', state, ['child']);

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.strictEqual(msg.hook, 'nodeStart');
      assert.strictEqual(msg.correlationId, CORR);
      assert.strictEqual(msg.nodeName, 'my-node');
      assert.strictEqual(msg.phase, '');
      assert.strictEqual(msg.output, null);
      assert.deepStrictEqual(msg.placementPath, ['parent-embed', 'child']);
    }
  });

  void it('all hook overrides forward correct BridgeMessage fields', () => {
    const ch = new CollectingChannel();

    class ExposedObserver extends WorkerObserver<NodeStateBase> {
      callNodeStart(n: string, s: NodeStateBase, p: readonly string[]): void { this.onNodeStart(n, s, p); }
      callNodeEnd(n: string, o: string | null, s: NodeStateBase, p: readonly string[]): void { this.onNodeEnd(n, o, s, p); }
      callPhaseEnter(d: string, ph: 'pre' | 'post', pn: string, s: NodeStateBase, p: readonly string[]): void { this.onPhaseEnter(d, ph, pn, s, p); }
      callPhaseExit(d: string, ph: 'pre' | 'post', pn: string, s: NodeStateBase, p: readonly string[]): void { this.onPhaseExit(d, ph, pn, s, p); }
      callError(n: string, e: Error, s: NodeStateBase, p: readonly string[]): void { this.onError(n, e, s, p); }
      callContractWarning(m: string): void { this.onContractWarning(m); }
      callFlowStart(d: string, s: NodeStateBase): void { this.onFlowStart(d, s); }
    }
    const exposed = new ExposedObserver(ch, CORR, BASE, {});

    // nodeStart
    ch.sent.length = 0;
    exposed.callNodeStart('my-node', state, ['child']);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'nodeStart');
      assert.deepStrictEqual(ch.sent[0].placementPath, ['parent-embed', 'child']);
    }

    // nodeEnd
    ch.sent.length = 0;
    exposed.callNodeEnd('my-node', 'success', state, ['child']);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'nodeEnd');
      assert.strictEqual(ch.sent[0].output, 'success');
      assert.deepStrictEqual(ch.sent[0].placementPath, ['parent-embed', 'child']);
    }

    // phaseEnter
    ch.sent.length = 0;
    exposed.callPhaseEnter('dag', 'pre', 'placement', state, []);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'phaseEnter');
      assert.strictEqual(ch.sent[0].phase, 'pre');
      assert.strictEqual(ch.sent[0].nodeName, 'placement');
    }

    // phaseExit
    ch.sent.length = 0;
    exposed.callPhaseExit('dag', 'post', 'placement', state, []);
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'phaseExit');
      assert.strictEqual(ch.sent[0].phase, 'post');
    }

    // contractWarning
    ch.sent.length = 0;
    exposed.callContractWarning('unbound container role');
    assert.strictEqual(ch.sent[0]?.kind, 'instrumentation');
    if (ch.sent[0]?.kind === 'instrumentation') {
      assert.strictEqual(ch.sent[0].hook, 'contractWarning');
      assert.strictEqual(ch.sent[0].message, 'unbound container role');
      assert.deepStrictEqual(ch.sent[0].placementPath, []);
    }

    // error
    ch.sent.length = 0;
    exposed.callError('node', new Error('test error'), state, ['inner']);
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

  void it('basePath is prepended to every composable hook', () => {
    const ch = new CollectingChannel();

    class ExposedObserver extends WorkerObserver<NodeStateBase> {
      callNodeStart(n: string, s: NodeStateBase, p: readonly string[]): void { this.onNodeStart(n, s, p); }
    }
    const exposed = new ExposedObserver(ch, CORR, ['a', 'b'], {});
    exposed.callNodeStart('n', state, ['c']);

    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    if (msg.kind === 'instrumentation') {
      assert.deepStrictEqual(msg.placementPath, ['a', 'b', 'c']);
    }
  });
});
