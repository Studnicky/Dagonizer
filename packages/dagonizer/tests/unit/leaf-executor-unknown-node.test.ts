import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import type { SingleNodePlacementType } from '../../src/entities/dag/SingleNode.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import { DAGError } from '../../src/errors/index.js';
import type { LeafExecutorSourceInterface } from '../../src/execution/LeafExecutor.js';
import { LeafExecutor } from '../../src/execution/LeafExecutor.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

class PlainState extends NodeStateBase {}

/** Builds a fake `LeafExecutorSourceInterface` whose `nodes` map holds exactly `names.length` registered nodes. */
function sourceOf(names: readonly string[]): LeafExecutorSourceInterface {
  const nodes = new Map<string, NodeInterface<NodeStateBase, string>>();
  for (const name of names) {
    nodes.set(`urn:test:node:${name}`, TestNode.make<PlainState>(name, ['success']));
  }
  return {
    nodes,
    "withNodeTimeout": async (_node, signal, fn) => fn(signal),
    "nodeContext": (dagName, placementName, signal) => NodeContext.create(dagName, placementName, signal),
    "runNodeOnState": async () => 'success',
  };
}

function placementFor(nodeRef: string): SingleNodePlacementType {
  return {
    '@id':   'urn:test:dag:x/node/only',
    '@type': 'SingleNode',
    'name':  'only',
    'node':  nodeRef,
    'outputs': {},
  };
}

void describe('LeafExecutor unknown-node message enrichment', () => {
  void it('lists every registered node name when 5 or fewer are registered', async () => {
    const source = sourceOf(['alpha', 'beta', 'gamma']);
    const leafExecutor = new LeafExecutor(source);

    await assert.rejects(
      () => leafExecutor.executeSingleNode(placementFor('missing'), new PlainState(), 'dag', new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.match(err.message, /^Unknown node: 'missing'\./);
        assert.match(err.message, /Registered nodes: alpha, beta, gamma\./);
        assert.match(err.message, /Did you forget dispatcher\.registerNode\(\.\.\.\)\?$/);
        assert.doesNotMatch(err.message, /…/u);
        return true;
      },
    );
  });

  void it('bounds the listed names to 5 and elides the rest when more are registered', async () => {
    const source = sourceOf(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']);
    const leafExecutor = new LeafExecutor(source);

    await assert.rejects(
      () => leafExecutor.executeSingleNode(placementFor('missing'), new PlainState(), 'dag', new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.match(err.message, /Registered nodes: n1, n2, n3, n4, n5, …\./);
        return true;
      },
    );
  });

  void it('reports no nodes registered when the registry is empty', async () => {
    const source = sourceOf([]);
    const leafExecutor = new LeafExecutor(source);

    await assert.rejects(
      () => leafExecutor.executeSingleNode(placementFor('missing'), new PlainState(), 'dag', new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.match(err.message, /No nodes are registered\./);
        return true;
      },
    );
  });
});
