import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Timing } from '@studnicky/timing';

import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { DagLoggerInterface } from '../../src/ObservedDag.js';
import { ObservedDag } from '../../src/ObservedDag.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = (dagName: string, placementName: string): string => `${dagName}/node/${placementName}`;

const NULL_LOGGER: DagLoggerInterface = {
  trace(): void { /* test sink */ },
  debug(): void { /* test sink */ },
  info(): void { /* test sink */ },
  error(): void { /* test sink */ },
};

const OBSERVED_TIMING_DAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:observed-timing',
  '@type':    'DAG',
  'name':     'observed-timing',
  'version':  '1',
  'entrypoints': { 'main': placementIri('urn:noocodec:dag:observed-timing', 'work') },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:observed-timing/node/work',
      '@type':  'SingleNode',
      'name':   'work',
      'node':   'urn:noocodec:node:work',
      'outputs': { 'success': placementIri('urn:noocodec:dag:observed-timing', 'end') },
    },
    {
      '@id': 'urn:noocodec:dag:observed-timing/node/end',
      '@type':  'TerminalNode',
      'name':   'end',
      'outcome': 'completed',
    },
  ],
};

void describe('ObservedDag timing', () => {
  void it('records flow and node timing events through a consumer-supplied Timing sink', async () => {
    const timing = Timing.create();
    const dispatcher = new ObservedDag<NodeStateBase>(NULL_LOGGER, { timing });
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:work', ['success'], () => 'success'));
    dispatcher.registerDAG(OBSERVED_TIMING_DAG);

    await dispatcher.execute('urn:noocodec:dag:observed-timing', new NodeStateBase());

    const events = timing.getEvents();
    assert.equal(typeof events['dag.flow.start'], 'number');
    assert.equal(typeof events['dag.flow.complete'], 'number');
    assert.equal(typeof events['dag.node.start'], 'number');
    assert.equal(typeof events['dag.node.complete'], 'number');
  });
});
