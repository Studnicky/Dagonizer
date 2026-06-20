import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('Dagonizer AbortSignal cancellation', () => {
  void it('marks state cancelled when caller aborts before DAG starts', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    class SlowNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'slow';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase, context: NodeContextType): Promise<NodeOutputType<'success'>> {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 1000);
          context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { 'once': true });
        });
        return { 'errors': [], 'output': 'success' };
      }
    }
    const slowNode = new SlowNode();
    dispatcher.registerNode(slowNode);
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:cancel',
      '@type':    'DAG',
      'name': 'cancel',
      'version': '1',
      'entrypoint': 'slow',
      'nodes': [{
        '@id':   'urn:noocodex:dag:cancel/node/slow',
        '@type': 'SingleNode',
        'name':  'slow', 'node': 'slow', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:cancel/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });

    const controller = new AbortController();
    controller.abort(new Error('user aborted'));
    const state = new NodeStateBase();
    const result = await dispatcher.execute('cancel', state, { 'signal': controller.signal });
    assert.equal(state.lifecycle.variant, 'cancelled');
    assert.equal(result.cursor, 'slow');
    assert.deepEqual(result.interruptedAt, { 'nodeName': 'slow', 'reason': 'abort' });
  });

  void it('records interruptedAt when caller aborts mid-flow at a downstream node', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const controller = new AbortController();
    class FirstNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'first';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase): Promise<NodeOutputType<'success'>> { return { 'errors': [], 'output': 'success' }; }
    }
    class SecondNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'second';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase): Promise<NodeOutputType<'success'>> {
        // Trip the controller before this node returns so the next iteration
        // observes `signal.aborted` BEFORE running the downstream stage.
        controller.abort(new Error('mid-flow cancel'));
        return { 'errors': [], 'output': 'success' };
      }
    }
    class ThirdNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'third';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase): Promise<NodeOutputType<'success'>> { return { 'errors': [], 'output': 'success' }; }
    }
    dispatcher.registerNode(new FirstNode());
    dispatcher.registerNode(new SecondNode());
    dispatcher.registerNode(new ThirdNode());
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:mid-cancel',
      '@type':    'DAG',
      'name':       'mid-cancel',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:mid-cancel/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'first', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:mid-cancel/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'second', 'outputs': { 'success': 'c' } },
        { '@id': 'urn:noocodex:dag:mid-cancel/node/c', '@type': 'SingleNode',
          'name': 'c', 'node': 'third', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:mid-cancel/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });

    const state = new NodeStateBase();
    const result = await dispatcher.execute('mid-cancel', state, { 'signal': controller.signal });
    assert.equal(state.lifecycle.variant, 'cancelled');
    // The loop checks `signal.aborted` before running 'c', so the cursor and
    // interruptedAt.nodeName point at the node that would have run next.
    assert.equal(result.cursor, 'c');
    assert.deepEqual(result.interruptedAt, { 'nodeName': 'c', 'reason': 'abort' });
  });

  void it('marks state timed_out when deadlineMs elapses', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    class SlowTimeoutNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'slow';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase, context: NodeContextType): Promise<NodeOutputType<'success'>> {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { 'once': true });
        });
        return { 'errors': [], 'output': 'success' };
      }
    }
    const slowNode = new SlowTimeoutNode();
    dispatcher.registerNode(slowNode);
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t',
      '@type':    'DAG',
      'name': 't',
      'version': '1',
      'entrypoint': 'slow',
      'nodes': [{
        '@id':   'urn:noocodex:dag:t/node/slow',
        '@type': 'SingleNode',
        'name':  'slow', 'node': 'slow', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:t/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });

    const state = new NodeStateBase();
    const result = await dispatcher.execute('t', state, { 'deadlineMs': 25 });
    assert.equal(state.lifecycle.variant, 'timed_out');
    assert.equal(result.cursor, 'slow');
    assert.deepEqual(result.interruptedAt, { 'nodeName': 'slow', 'reason': 'timeout' });
  });

  void it('passes dagName/nodeName through NodeContext', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const seen: { dag: string; node: string } = { 'dag': '', 'node': '' };
    class InspectNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'inspect';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase, context: NodeContextType): Promise<NodeOutputType<'success'>> {
        seen.dag = context.dagName;
        seen.node = context.nodeName;
        return { 'errors': [], 'output': 'success' };
      }
    }
    dispatcher.registerNode(new InspectNode());
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:inspect-dag',
      '@type':    'DAG',
      'name': 'inspect-dag',
      'version': '1',
      'entrypoint': 's1',
      'nodes': [{
        '@id':   'urn:noocodex:dag:inspect-dag/node/s1',
        '@type': 'SingleNode',
        'name':  's1', 'node': 'inspect', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:inspect-dag/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });
    const result = await dispatcher.execute('inspect-dag', new NodeStateBase());
    assert.equal(seen.dag, 'inspect-dag');
    assert.equal(seen.node, 's1');
    assert.equal(result.interruptedAt, null);
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
      protected override onNodeEnd(nodeName: string, output: string | null): void {
        events.push(`stage:end:${nodeName}:${output ?? '-'}`);
      }
    }

    const dispatcher = new TracedDagonizer();
    class OpNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'op';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase): Promise<NodeOutputType<'success'>> { return { 'errors': [], 'output': 'success' }; }
    }
    dispatcher.registerNode(new OpNode());
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:hooked',
      '@type':    'DAG',
      'name': 'hooked',
      'version': '1',
      'entrypoint': 'a',
      'nodes': [
        { '@id': 'urn:noocodex:dag:hooked/node/a', '@type': 'SingleNode',
          'name': 'a', 'node': 'op', 'outputs': { 'success': 'b' } },
        { '@id': 'urn:noocodex:dag:hooked/node/b', '@type': 'SingleNode',
          'name': 'b', 'node': 'op', 'outputs': { 'success': 'end' } },
        { '@id': 'urn:noocodex:dag:hooked/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });
    await dispatcher.execute('hooked', new NodeStateBase());
    assert.deepEqual(events, [
      'flow:start:hooked',
      'stage:start:a',
      'stage:end:a:success',
      'stage:start:b',
      'stage:end:b:success',
      'stage:start:end',
      'stage:end:end:completed',
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
    class BoomNode extends ScalarNode<NodeStateBase, 'success'> {
      readonly name = 'boom';
      readonly outputs = ['success'] as const;
      protected async executeOne(_state: NodeStateBase): Promise<NodeOutputType<'success'>> { throw new Error('kaboom'); }
    }
    dispatcher.registerNode(new BoomNode());
    dispatcher.registerDAG({
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:err',
      '@type':    'DAG',
      'name': 'err',
      'version': '1',
      'entrypoint': 's',
      'nodes': [{
        '@id':   'urn:noocodex:dag:err/node/s',
        '@type': 'SingleNode',
        'name':  's', 'node': 'boom', 'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:err/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    });
    const result = await dispatcher.execute('err', new NodeStateBase());
    assert.equal(result.cursor, 's');
    assert.equal(result.state.lifecycle.variant, 'failed');
    // Node throws without abort signal; lifecycle is `failed`, not a
    // cancellation. interruptedAt MUST be null.
    assert.equal(result.interruptedAt, null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.stage, 's');
    assert.equal(seen[0]?.message, 'kaboom');
  });
});
