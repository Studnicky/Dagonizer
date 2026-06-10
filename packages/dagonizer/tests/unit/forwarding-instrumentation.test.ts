/**
 * forwarding-instrumentation.test.ts
 *
 * Verifies that ForwardingInstrumentation routes all six Instrumentation hooks
 * (nodeStart, nodeEnd, phaseEnter, phaseExit, contractWarning, error) as
 * BridgeMessage { kind: 'instrumentation' } messages over its channel.
 * Also confirms flowStart and flowEnd are suppressed (no message sent).
 *
 * Coverage target: G6.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ForwardingInstrumentation } from '../../src/container/ForwardingInstrumentation.js';
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

void describe('ForwardingInstrumentation — all-six-hook routing (G6)', () => {
  void it('nodeStart forwards as instrumentation with hook=nodeStart and composed path', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, BASE);
    fi.nodeStart('my-dag', 'my-node', state, ['child']);

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.strictEqual(msg.hook, 'nodeStart');
      assert.strictEqual(msg.correlationId, CORR);
      assert.strictEqual(msg.dagName, 'my-dag');
      assert.strictEqual(msg.nodeName, 'my-node');
      assert.strictEqual(msg.phase, '');
      assert.strictEqual(msg.output, null);
      assert.deepStrictEqual(msg.placementPath, ['parent-embed', 'child']);
    }
  });

  void it('nodeEnd forwards as instrumentation with hook=nodeEnd and all populated fields', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, BASE);
    fi.nodeEnd('my-dag', 'my-node', 'success', state, ['child']);

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.strictEqual(msg.hook, 'nodeEnd');
      assert.strictEqual(msg.correlationId, CORR);
      assert.strictEqual(msg.dagName, 'my-dag');
      assert.strictEqual(msg.nodeName, 'my-node');
      assert.strictEqual(msg.output, 'success');
      assert.deepStrictEqual(msg.placementPath, ['parent-embed', 'child']);
    }
  });

  void it('phaseEnter forwards as instrumentation with hook=phaseEnter and all populated fields', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, []);
    fi.phaseEnter('dag', 'pre', 'placement', state, []);

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.strictEqual(msg.hook, 'phaseEnter');
      assert.strictEqual(msg.correlationId, CORR);
      assert.strictEqual(msg.dagName, 'dag');
      assert.strictEqual(msg.nodeName, 'placement');
      assert.strictEqual(msg.phase, 'pre');
      assert.strictEqual(msg.output, null);
      assert.deepStrictEqual(msg.placementPath, []);
    }
  });

  void it('phaseExit forwards as instrumentation with hook=phaseExit and all populated fields', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, []);
    fi.phaseExit('dag', 'post', 'placement', state, []);

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.strictEqual(msg.hook, 'phaseExit');
      assert.strictEqual(msg.correlationId, CORR);
      assert.strictEqual(msg.dagName, 'dag');
      assert.strictEqual(msg.nodeName, 'placement');
      assert.strictEqual(msg.phase, 'post');
      assert.strictEqual(msg.output, null);
      assert.deepStrictEqual(msg.placementPath, []);
    }
  });

  void it('contractWarning forwards as instrumentation with hook=contractWarning and message', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, []);
    fi.contractWarning('unbound container role');

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.strictEqual(msg.hook, 'contractWarning');
      assert.strictEqual(msg.message, 'unbound container role');
      assert.deepStrictEqual(msg.placementPath, []);
    }
  });

  void it('error forwards as instrumentation with hook=error and message', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, BASE);
    fi.error('dag', 'node', new Error('test error'), state, ['inner']);

    assert.strictEqual(ch.sent.length, 1);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    assert.strictEqual(msg.kind, 'instrumentation');
    if (msg.kind === 'instrumentation') {
      assert.strictEqual(msg.hook, 'error');
      assert.strictEqual(msg.message, 'test error');
      assert.deepStrictEqual(msg.placementPath, ['parent-embed', 'inner']);
    }
  });

  void it('flowStart is suppressed — sends no message', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, []);
    fi.flowStart('dag', state);
    assert.strictEqual(ch.sent.length, 0, 'flowStart must not send any message');
  });

  void it('flowEnd is suppressed — sends no message', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, []);
    // Pass a minimal result shape.
    fi.flowEnd('dag', state, {
      'cursor': null,
      'executedNodes': [],
      'skippedNodes': [],
      'state': state,
      'terminalOutcome': null,
      'interruptedAt': null,
    });
    assert.strictEqual(ch.sent.length, 0, 'flowEnd must not send any message');
  });

  void it('basePath is prepended to every composable hook', () => {
    const ch = new CollectingChannel();
    const fi = new ForwardingInstrumentation(ch, CORR, ['a', 'b']);
    fi.nodeStart('d', 'n', state, ['c']);
    const msg = ch.sent[0];
    assert.ok(msg !== undefined);
    if (msg.kind === 'instrumentation') {
      assert.deepStrictEqual(msg.placementPath, ['a', 'b', 'c']);
    }
  });
});
