import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const node = (name: string, outputs: readonly string[]) => TestNode.make<NodeStateBase>(name, outputs, () => outputs[0] as string);

const makeDAG = (name: string, entrypoint: string, nodes: DAGType['nodes']): DAGType => ({
  '@context': DAG_CONTEXT, '@id': `urn:noocodex:dag:${name}`, '@type': 'DAG',
  name, 'version': '1', entrypoint, nodes,
});

void describe('Execution streaming (async-iterable)', () => {
  void it('yields each node stage incrementally, then resolves to the final result', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(node('a', ['success']));
    dispatcher.registerNode(node('b', ['success']));
    dispatcher.registerDAG(makeDAG('linear', 'a', [
      { '@id': 'urn:noocodex:dag:linear/node/a', '@type': 'SingleNode', 'name': 'a', 'node': 'a', 'outputs': { 'success': 'b' } },
      { '@id': 'urn:noocodex:dag:linear/node/b', '@type': 'SingleNode', 'name': 'b', 'node': 'b', 'outputs': { 'success': 'end' } },
      { '@id': 'urn:noocodex:dag:linear/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
    ]));

    const exec = dispatcher.execute('linear', new NodeStateBase());
    const seen: string[] = [];
    for await (const stage of exec) seen.push(stage.nodeName);

    // Each node surfaced as its own stage, in execution order.
    assert.deepEqual(seen, ['a', 'b', 'end']);
    // Awaiting the already-iterated Execution returns the cached final result.
    const final = await exec;
    assert.equal(final.state.lifecycle.variant, 'completed');
    assert.deepEqual(final.executedNodes, ['a', 'b', 'end']);
  });

  void it('streams a composite node’s intermediate results before the node itself', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(node('start', ['success']));
    dispatcher.registerNode(node('inner', ['success']));

    dispatcher.registerDAG(makeDAG('child', 'inner', [
      { '@id': 'urn:noocodex:dag:child/node/inner', '@type': 'SingleNode', 'name': 'inner', 'node': 'inner', 'outputs': { 'success': 'child-end' } },
      { '@id': 'urn:noocodex:dag:child/node/child-end', '@type': 'TerminalNode', 'name': 'child-end', 'outcome': 'completed' },
    ]));
    dispatcher.registerDAG(makeDAG('outer', 'start', [
      { '@id': 'urn:noocodex:dag:outer/node/start', '@type': 'SingleNode', 'name': 'start', 'node': 'start', 'outputs': { 'success': 'embed' } },
      { '@id': 'urn:noocodex:dag:outer/node/embed', '@type': 'EmbeddedDAGNode', 'name': 'embed', 'dag': 'child', 'outputs': { 'success': 'outer-end', 'error': 'outer-end' } },
      { '@id': 'urn:noocodex:dag:outer/node/outer-end', '@type': 'TerminalNode', 'name': 'outer-end', 'outcome': 'completed' },
    ]));

    const seen: string[] = [];
    for await (const stage of dispatcher.execute('outer', new NodeStateBase())) seen.push(stage.nodeName);

    // The embedded-DAG's inner step streams as its own stage (prefixed with the
    // placement name), BEFORE the embed placement's own result, proving nested
    // intermediate results flow through the stream incrementally.
    // The child's TerminalNode also streams as an intermediate stage.
    assert.deepEqual(seen, ['start', 'embed.inner', 'embed.child-end', 'embed', 'outer-end']);
  });
});
