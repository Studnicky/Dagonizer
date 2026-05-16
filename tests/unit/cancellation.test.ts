import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('Dagonizer AbortSignal cancellation', () => {
  void it('marks state cancelled when caller aborts before DAG starts', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const slowNode: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'slow',
      'outputs': ['success'],
      async execute(_state, context) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 1000);
          context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { "once": true });
        });
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(slowNode);
    dispatcher.registerDAG({
      'name': 'cancel',
      'version': '1',
      'entrypoint': 'slow',
      'nodes': [{ 'type': 'single', 'name': 'slow', 'node': 'slow', 'outputs': { 'success': null } }],
    });

    const controller = new AbortController();
    controller.abort(new Error('user aborted'));
    const state = new NodeStateBase();
    const result = await dispatcher.execute('cancel', state, { 'signal': controller.signal });
    assert.equal(state.lifecycle.kind, 'cancelled');
    assert.equal(result.cursor, 'slow');
  });

  void it('marks state timed_out when deadlineMs elapses', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const slowNode: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'slow',
      'outputs': ['success'],
      async execute(_state, context) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { "once": true });
        });
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(slowNode);
    dispatcher.registerDAG({
      'name': 't',
      'version': '1',
      'entrypoint': 'slow',
      'nodes': [{ 'type': 'single', 'name': 'slow', 'node': 'slow', 'outputs': { 'success': null } }],
    });

    const state = new NodeStateBase();
    const result = await dispatcher.execute('t', state, { 'deadlineMs': 25 });
    assert.equal(state.lifecycle.kind, 'timed_out');
    assert.equal(result.cursor, 'slow');
  });

  void it('passes dagName/nodeName through NodeContext', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const seen: { dag: string; node: string } = { 'dag': '', 'node': '' };
    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'inspect',
      'outputs': ['success'],
      async execute(_state, context) {
        seen.dag = context.dagName;
        seen.node = context.nodeName;
        return { 'output': 'success' };
      },
    };
    dispatcher.registerNode(op);
    dispatcher.registerDAG({
      'name': 'inspect-dag',
      'version': '1',
      'entrypoint': 's1',
      'nodes': [{ 'type': 'single', 'name': 's1', 'node': 'inspect', 'outputs': { 'success': null } }],
    });
    await dispatcher.execute('inspect-dag', new NodeStateBase());
    assert.equal(seen.dag, 'inspect-dag');
    assert.equal(seen.node, 's1');
  });
});

void describe('Dagonizer extension hooks', () => {
  void it('subclass hooks fire at DAG + stage seams', async () => {
    const events: string[] = [];

    class TracedDagonizer extends Dagonizer<NodeStateBase> {
      protected override onFlowStart(dagName: string): void {
        events.push(`flow:start:${dagName}`);
      }
      protected override onFlowEnd(dagName: string): void {
        events.push(`flow:end:${dagName}`);
      }
      protected override onNodeStart(nodeName: string): void {
        events.push(`stage:start:${nodeName}`);
      }
      protected override onNodeEnd(nodeName: string, output: string | undefined): void {
        events.push(`stage:end:${nodeName}:${output ?? '-'}`);
      }
    }

    const dispatcher = new TracedDagonizer();
    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'op',
      'outputs': ['success'],
      async execute() { return { 'output': 'success' }; },
    };
    dispatcher.registerNode(op);
    dispatcher.registerDAG({
      'name': 'hooked',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        { 'type': 'single', 'name': 'a', 'node': 'op', 'outputs': { 'success': 'b' } },
        { 'type': 'single', 'name': 'b', 'node': 'op', 'outputs': { 'success': null } },
      ],
    });
    await dispatcher.execute('hooked', new NodeStateBase());
    assert.deepEqual(events, [
      'flow:start:hooked',
      'stage:start:a',
      'stage:end:a:success',
      'stage:start:b',
      'stage:end:b:success',
      'flow:end:hooked',
    ]);
  });

  void it('onError fires when a node throws', async () => {
    const seen: Array<{ stage: string; message: string }> = [];

    class ErrTraced extends Dagonizer<NodeStateBase> {
      protected override onError(nodeName: string, error: Error): void {
        seen.push({ 'stage': nodeName, 'message': error.message });
      }
    }

    const dispatcher = new ErrTraced();
    const op: NodeInterface<NodeStateBase, 'success'> = {
      'name': 'boom',
      'outputs': ['success'],
      async execute() { throw new Error('kaboom'); },
    };
    dispatcher.registerNode(op);
    dispatcher.registerDAG({
      'name': 'err',
      'version': '1',
      'entrypoint': 's',
      'nodes': [{ 'type': 'single', 'name': 's', 'node': 'boom', 'outputs': { 'success': null } }],
    });
    const result = await dispatcher.execute('err', new NodeStateBase());
    assert.equal(result.cursor, 's');
    assert.equal(result.state.lifecycle.kind, 'failed');
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.stage, 's');
    assert.equal(seen[0]?.message, 'kaboom');
  });
});
