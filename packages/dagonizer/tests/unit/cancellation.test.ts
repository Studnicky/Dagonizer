import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

const CANCEL_DAG_IRI = 'urn:noocodex:dag:cancel';
const MID_CANCEL_DAG_IRI = 'urn:noocodex:dag:mid-cancel';
const TIMEOUT_DAG_IRI = 'urn:noocodex:dag:t';
const INSPECT_DAG_IRI = 'urn:noocodex:dag:inspect-dag';
const HOOKED_DAG_IRI = 'urn:noocodex:dag:hooked';
const ERROR_DAG_IRI = 'urn:noocodex:dag:err';

void describe('Dagonizer AbortSignal cancellation', () => {
  void it('marks state cancelled when caller aborts before DAG starts', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:slow', ['success'], async (_state, context) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 1000);
        context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { 'once': true });
      });
      return 'success';
    }));
    dispatcher.registerDAG(TestDag.from({
      '@context': DAG_CONTEXT,
      '@id':      CANCEL_DAG_IRI,
      '@type':    'DAG',
      'name': 'cancel',
      'version': '1',
      'entrypoints': { 'main': `${CANCEL_DAG_IRI}/node/slow` },
      'nodes': [{
        '@id':   `${CANCEL_DAG_IRI}/node/slow`,
        '@type': 'SingleNode',
        'name':  'slow', 'node': 'urn:noocodec:node:slow', 'outputs': { 'success': `${CANCEL_DAG_IRI}/node/end` },
      },
        { '@id': `${CANCEL_DAG_IRI}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    }));

    const controller = new AbortController();
    controller.abort(new Error('user aborted'));
    const state = new NodeStateBase();
    const result = await dispatcher.execute(CANCEL_DAG_IRI, state, { 'signal': controller.signal });
    assert.equal(state.lifecycle.variant, 'cancelled');
    assert.equal(result.cursor, `${CANCEL_DAG_IRI}/node/slow`);
    assert.deepEqual(result.interruptedAt, { 'nodeName': `${CANCEL_DAG_IRI}/node/slow`, 'reason': 'abort' });
  });

  void it('records interruptedAt when caller aborts mid-flow at a downstream node', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const controller = new AbortController();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:first', ['success'], () => 'success'));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:second', ['success'], () => {
      // Trip the controller before this node returns so the next iteration
      // observes `signal.aborted` BEFORE running the downstream stage.
      controller.abort(new Error('mid-flow cancel'));
      return 'success';
    }));
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:third', ['success'], () => 'success'));
    dispatcher.registerDAG(TestDag.from({
      '@context': DAG_CONTEXT,
      '@id':      MID_CANCEL_DAG_IRI,
      '@type':    'DAG',
      'name':       'mid-cancel',
      'version':    '1',
      'entrypoints': { 'main': `${MID_CANCEL_DAG_IRI}/node/a` },
      'nodes': [
        { '@id': `${MID_CANCEL_DAG_IRI}/node/a`, '@type': 'SingleNode',
          'name': 'a', 'node': 'urn:noocodec:node:first', 'outputs': { 'success': `${MID_CANCEL_DAG_IRI}/node/b` } },
        { '@id': `${MID_CANCEL_DAG_IRI}/node/b`, '@type': 'SingleNode',
          'name': 'b', 'node': 'urn:noocodec:node:second', 'outputs': { 'success': `${MID_CANCEL_DAG_IRI}/node/c` } },
        { '@id': `${MID_CANCEL_DAG_IRI}/node/c`, '@type': 'SingleNode',
          'name': 'c', 'node': 'urn:noocodec:node:third', 'outputs': { 'success': `${MID_CANCEL_DAG_IRI}/node/end` } },
        { '@id': `${MID_CANCEL_DAG_IRI}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    }));

    const state = new NodeStateBase();
    const result = await dispatcher.execute(MID_CANCEL_DAG_IRI, state, { 'signal': controller.signal });
    assert.equal(state.lifecycle.variant, 'cancelled');
    // The loop checks `signal.aborted` before running 'c', so the cursor and
    // interruptedAt.nodeName point at the node that would have run next.
    assert.equal(result.cursor, `${MID_CANCEL_DAG_IRI}/node/c`);
    assert.deepEqual(result.interruptedAt, { 'nodeName': `${MID_CANCEL_DAG_IRI}/node/c`, 'reason': 'abort' });
  });

  void it('marks state timed_out when deadlineMs elapses', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:slow', ['success'], async (_state, context) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 5000);
        context.signal.addEventListener('abort', () => { clearTimeout(t); reject(context.signal.reason); }, { 'once': true });
      });
      return 'success';
    }));
    dispatcher.registerDAG(TestDag.from({
      '@context': DAG_CONTEXT,
      '@id':      TIMEOUT_DAG_IRI,
      '@type':    'DAG',
      'name': 't',
      'version': '1',
      'entrypoints': { 'main': `${TIMEOUT_DAG_IRI}/node/slow` },
      'nodes': [{
        '@id':   `${TIMEOUT_DAG_IRI}/node/slow`,
        '@type': 'SingleNode',
        'name':  'slow', 'node': 'urn:noocodec:node:slow', 'outputs': { 'success': `${TIMEOUT_DAG_IRI}/node/end` },
      },
        { '@id': `${TIMEOUT_DAG_IRI}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    }));

    const state = new NodeStateBase();
    const result = await dispatcher.execute(TIMEOUT_DAG_IRI, state, { 'deadlineMs': 25 });
    assert.equal(state.lifecycle.variant, 'timed_out');
    assert.equal(result.cursor, `${TIMEOUT_DAG_IRI}/node/slow`);
    assert.deepEqual(result.interruptedAt, { 'nodeName': `${TIMEOUT_DAG_IRI}/node/slow`, 'reason': 'timeout' });
  });

  void it('passes dagName/nodeName through NodeContext', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    const seen: { dag: string; node: string } = { 'dag': '', 'node': '' };
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:inspect', ['success'], (_state, context) => {
      seen.dag = context.dagName;
      seen.node = context.nodeName;
      return 'success';
    }));
    dispatcher.registerDAG(TestDag.from({
      '@context': DAG_CONTEXT,
      '@id':      INSPECT_DAG_IRI,
      '@type':    'DAG',
      'name': 'inspect-dag',
      'version': '1',
      'entrypoints': { 'main': `${INSPECT_DAG_IRI}/node/s1` },
      'nodes': [{
        '@id':   `${INSPECT_DAG_IRI}/node/s1`,
        '@type': 'SingleNode',
        'name':  's1', 'node': 'urn:noocodec:node:inspect', 'outputs': { 'success': `${INSPECT_DAG_IRI}/node/end` },
      },
        { '@id': `${INSPECT_DAG_IRI}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    }));
    const result = await dispatcher.execute(INSPECT_DAG_IRI, new NodeStateBase());
    assert.equal(seen.dag, INSPECT_DAG_IRI);
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
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:op', ['success'], () => 'success'));
    dispatcher.registerDAG(TestDag.from({
      '@context': DAG_CONTEXT,
      '@id':      HOOKED_DAG_IRI,
      '@type':    'DAG',
      'name': 'hooked',
      'version': '1',
      'entrypoints': { 'main': `${HOOKED_DAG_IRI}/node/a` },
      'nodes': [
        { '@id': `${HOOKED_DAG_IRI}/node/a`, '@type': 'SingleNode',
          'name': 'a', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': `${HOOKED_DAG_IRI}/node/b` } },
        { '@id': `${HOOKED_DAG_IRI}/node/b`, '@type': 'SingleNode',
          'name': 'b', 'node': 'urn:noocodec:node:op', 'outputs': { 'success': `${HOOKED_DAG_IRI}/node/end` } },
        { '@id': `${HOOKED_DAG_IRI}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    }));
    await dispatcher.execute(HOOKED_DAG_IRI, new NodeStateBase());
    assert.deepEqual(events, [
      `flow:start:${HOOKED_DAG_IRI}`,
      'stage:start:a',
      'stage:end:a:success',
      'stage:start:b',
      'stage:end:b:success',
      'stage:start:end',
      'stage:end:end:completed',
      `flow:end:${HOOKED_DAG_IRI}`,
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
    class BoomNode extends MonadicNode<NodeStateBase, 'success'> {
      readonly name = 'boom';
      readonly '@id' = 'urn:noocodec:node:boom';
      readonly outputs = ['success'] as const;
      override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
      override async execute(_batch: Batch<NodeStateBase>): Promise<Map<'success', Batch<NodeStateBase>>> { throw new Error('kaboom'); }
    }
    dispatcher.registerNode(new BoomNode());
    dispatcher.registerDAG(TestDag.from({
      '@context': DAG_CONTEXT,
      '@id':      ERROR_DAG_IRI,
      '@type':    'DAG',
      'name': 'err',
      'version': '1',
      'entrypoints': { 'main': `${ERROR_DAG_IRI}/node/s` },
      'nodes': [{
        '@id':   `${ERROR_DAG_IRI}/node/s`,
        '@type': 'SingleNode',
        'name':  's', 'node': 'urn:noocodec:node:boom', 'outputs': { 'success': `${ERROR_DAG_IRI}/node/end` },
      },
        { '@id': `${ERROR_DAG_IRI}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    }));
    const result = await dispatcher.execute(ERROR_DAG_IRI, new NodeStateBase());
    assert.equal(result.cursor, `${ERROR_DAG_IRI}/node/s`);
    assert.equal(result.state.lifecycle.variant, 'failed');
    // Node throws without abort signal; lifecycle is `failed`, not a
    // cancellation. interruptedAt MUST be null.
    assert.equal(result.interruptedAt, null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.stage, `${ERROR_DAG_IRI}/node/s`);
    assert.equal(seen[0]?.message, 'kaboom');
  });
});
