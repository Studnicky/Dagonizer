/**
 * Scatter/dag-body terminal-outcome propagation.
 *
 * When an inner DAG exits via a `TerminalNode` placement, the inner
 * generator's `ExecutionResult.terminalOutcome` carries the outcome the
 * terminal declared. `executeScatter` reads that and uses it (in addition
 * to `cloneState.errors`) to decide whether the parent placement's
 * `success` or `error` output fires.
 *
 * Without this propagation, an inner `TerminalNode(failed)` would have
 * to be paired with an explicit `state.collectError()` call to surface
 * as `error` on the parent — losing the value of having an explicit
 * terminal placement in the inner DAG.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

const passNode: NodeInterface<NodeStateBase> = {
  'name': 'pass',
  'outputs': ['ok'],
  async execute() { return { 'output': 'ok' }; },
};

void describe('scatter/dag-body terminal-outcome propagation', () => {
  void it('inner TerminalNode(failed) routes parent to error without collectError', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    // Inner DAG: pass → terminal(failed). No collectError anywhere.
    const innerDag = new DAGBuilder('inner-fail', '1')
      .node('pass', passNode, { 'ok': 'end-fail' })
      .terminal('end-fail', 'failed')
      .build();
    dispatcher.registerDAG(innerDag);

    // Parent DAG: embedded-DAG node, success/error routing to distinct terminals.
    const parentDag = new DAGBuilder('parent', '1')
      .embeddedDAG('run-inner', 'inner-fail', { 'success': 'end-ok', 'error': 'end-bad' })
      .terminal('end-ok', 'completed')
      .terminal('end-bad', 'failed')
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent', state);

    assert.equal(result.terminalOutcome, 'failed', 'parent terminal outcome is failed');
    assert.equal(result.state.lifecycle.kind, 'failed', 'parent lifecycle is failed');
    assert.equal(result.state.errors.length, 0, 'no node errors collected');
    assert.ok(result.executedNodes.includes('end-bad'), 'parent routed through end-bad');
  });

  void it('inner TerminalNode(completed) routes parent to success', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    const innerDag = new DAGBuilder('inner-ok', '1')
      .node('pass', passNode, { 'ok': 'end-ok' })
      .terminal('end-ok', 'completed')
      .build();
    dispatcher.registerDAG(innerDag);

    const parentDag = new DAGBuilder('parent-ok', '1')
      .embeddedDAG('run-inner', 'inner-ok', { 'success': 'end-ok', 'error': 'end-bad' })
      .terminal('end-ok', 'completed')
      .terminal('end-bad', 'failed')
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-ok', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.ok(result.executedNodes.includes('end-ok'));
  });

  void it('inner null-route exit (no terminal hit) leaves terminalOutcome null and routes via errors check', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    // Inner DAG exits via null route (no explicit terminal).
    const innerDag = new DAGBuilder('inner-null', '1')
      .node('pass', passNode, { 'ok': null })
      .build();
    dispatcher.registerDAG(innerDag);

    const parentDag = new DAGBuilder('parent-null', '1')
      .embeddedDAG('run-inner', 'inner-null', { 'success': 'end-ok', 'error': 'end-bad' })
      .terminal('end-ok', 'completed')
      .terminal('end-bad', 'failed')
      .build();
    dispatcher.registerDAG(parentDag);

    const state = new NodeStateBase();
    const result = await dispatcher.execute('parent-null', state);

    // Parent routes via success (no errors, no inner terminal failed).
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.ok(result.executedNodes.includes('end-ok'));
  });

  void it('top-level execute() surfaces terminalOutcome on the returned result', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    const dag = new DAGBuilder('top', '1')
      .node('pass', passNode, { 'ok': 'end' })
      .terminal('end', 'completed')
      .build();
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('top', new NodeStateBase());
    assert.equal(result.terminalOutcome, 'completed');
  });

  void it('top-level execute() returns terminalOutcome=null when no terminal placement hit', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(passNode);

    const dag = new DAGBuilder('top-null', '1')
      .node('pass', passNode, { 'ok': null })
      .build();
    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('top-null', new NodeStateBase());
    assert.equal(result.terminalOutcome, null);
  });
});
