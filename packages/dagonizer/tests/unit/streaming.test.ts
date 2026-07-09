import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = TestDag.placementIri;

class StreamNode {
  private constructor() {}

  static of(iri: string, outputs: readonly string[]): NodeInterface<NodeStateBase> {
    return TestNode.make<NodeStateBase>(iri, outputs, () => outputs[0] ?? '');
  }
}

void describe('Execution streaming (async-iterable)', () => {
  void it('yields each node stage incrementally, then resolves to the final result', async () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(StreamNode.of('urn:noocodec:node:a', ['success']));
    dispatcher.registerNode(StreamNode.of('urn:noocodec:node:b', ['success']));
    dispatcher.registerDAG(TestDag.of('urn:noocodec:dag:linear', placementIri('urn:noocodec:dag:linear', 'a'), [
      { '@id': placementIri('urn:noocodec:dag:linear', 'a'), '@type': 'SingleNode', 'name': 'a', 'node': 'urn:noocodec:node:a', 'outputs': { 'success': placementIri('urn:noocodec:dag:linear', 'b') } },
      { '@id': placementIri('urn:noocodec:dag:linear', 'b'), '@type': 'SingleNode', 'name': 'b', 'node': 'urn:noocodec:node:b', 'outputs': { 'success': placementIri('urn:noocodec:dag:linear', 'end') } },
      { '@id': placementIri('urn:noocodec:dag:linear', 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
    ]));

    const exec = dispatcher.execute('urn:noocodec:dag:linear', new NodeStateBase());
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
    dispatcher.registerNode(StreamNode.of('urn:noocodec:node:start', ['success']));
    dispatcher.registerNode(StreamNode.of('urn:noocodec:node:inner', ['success']));

    dispatcher.registerDAG(TestDag.of('urn:noocodec:dag:child', placementIri('urn:noocodec:dag:child', 'inner'), [
      { '@id': placementIri('urn:noocodec:dag:child', 'inner'), '@type': 'SingleNode', 'name': 'inner', 'node': 'urn:noocodec:node:inner', 'outputs': { 'success': placementIri('urn:noocodec:dag:child', 'child-end') } },
      { '@id': placementIri('urn:noocodec:dag:child', 'child-end'), '@type': 'TerminalNode', 'name': 'child-end', 'outcome': 'completed' },
    ]));
    dispatcher.registerDAG(TestDag.of('urn:noocodec:dag:outer', placementIri('urn:noocodec:dag:outer', 'start'), [
      { '@id': placementIri('urn:noocodec:dag:outer', 'start'), '@type': 'SingleNode', 'name': 'start', 'node': 'urn:noocodec:node:start', 'outputs': { 'success': placementIri('urn:noocodec:dag:outer', 'embed') } },
      { '@id': placementIri('urn:noocodec:dag:outer', 'embed'), '@type': 'EmbeddedDAGNode', 'name': 'embed', 'dag': 'urn:noocodec:dag:child', 'outputs': { 'success': placementIri('urn:noocodec:dag:outer', 'outer-end'), 'error': placementIri('urn:noocodec:dag:outer', 'outer-end') } },
      { '@id': placementIri('urn:noocodec:dag:outer', 'outer-end'), '@type': 'TerminalNode', 'name': 'outer-end', 'outcome': 'completed' },
    ]));

    const seen: string[] = [];
    for await (const stage of dispatcher.execute('urn:noocodec:dag:outer', new NodeStateBase())) seen.push(stage.nodeName);

    // The embedded-DAG's inner step streams as its own stage (prefixed with the
    // placement name), BEFORE the embed placement's own result, proving nested
    // intermediate results flow through the stream incrementally.
    // The child's TerminalNode also streams as an intermediate stage.
    assert.deepEqual(seen, ['start', 'embed.inner', 'embed.child-end', 'embed', 'outer-end']);
  });
});
