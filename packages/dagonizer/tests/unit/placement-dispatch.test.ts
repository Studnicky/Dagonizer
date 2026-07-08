import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGError } from '../../src/errors/index.js';
import type {
  EmbeddedPlacementExecutorInterface,
  LeafPlacementExecutorInterface,
  ScatterPlacementExecutorInterface,
} from '../../src/execution/PlacementDispatch.js';
import { PlacementDispatch } from '../../src/execution/PlacementDispatch.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('PlacementDispatch', () => {
  void it('rejects direct GatherNode dispatch because gather is scheduler-owned', async () => {
    const dispatch = new PlacementDispatch(
      new UnusedLeafExecutor(),
      new UnusedEmbeddedExecutor(),
      new UnusedScatterExecutor(),
    );

    await assert.rejects(
      () => dispatch.dispatch({
        '@id':     'urn:noocodex:dag:test/node/join',
        '@type':   'GatherNode',
        'name':    'join',
        'sources': ['main'],
        'gather':  { 'strategy': 'discard' },
        'outputs': { 'success': 'done' },
      }, new NodeStateBase(), 'test', new AbortController().signal, [], true),
      (error: unknown) => error instanceof DAGError
        && error.message === "GatherNode 'join' is scheduler-managed and cannot be dispatched directly",
    );
  });
});

class UnusedLeafExecutor implements LeafPlacementExecutorInterface {
  async executeSingleNode(): ReturnType<LeafPlacementExecutorInterface['executeSingleNode']> {
    throw new DAGError('unused leaf executor');
  }
}

class UnusedEmbeddedExecutor implements EmbeddedPlacementExecutorInterface {
  async executeEmbeddedDAG(): ReturnType<EmbeddedPlacementExecutorInterface['executeEmbeddedDAG']> {
    throw new DAGError('unused embedded executor');
  }
}

class UnusedScatterExecutor implements ScatterPlacementExecutorInterface {
  async executeScatter(): ReturnType<ScatterPlacementExecutorInterface['executeScatter']> {
    throw new DAGError('unused scatter executor');
  }
}
