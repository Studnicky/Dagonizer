import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { TransientResultSelection } from '../../src/execution/TransientResultSelection.js';

void describe('TransientResultSelection.scatterResponseState', () => {
  void it('keys item response selections by success and error routes', () => {
    const dag = new DAGBuilder('urn:test:response-selection', '1')
      .scatter('urn:test:response-selection/scatter', 'items', { 'dag': 'urn:test:worker' }, {
        'all-success': 'urn:test:response-selection/success-gather',
        'partial': 'urn:test:response-selection/partial-gather',
        'all-error': 'urn:test:response-selection/error-gather',
        'empty': 'urn:test:response-selection/end',
      })
      .gather('urn:test:response-selection/success-gather', {
        'urn:test:response-selection/scatter': {},
      }, { 'strategy': 'map', 'mapping': { 'successValue': 'successes' } }, { 'success': 'urn:test:response-selection/end', 'error': 'urn:test:response-selection/end', 'empty': 'urn:test:response-selection/end' })
      .gather('urn:test:response-selection/partial-gather', {
        'urn:test:response-selection/scatter': {},
      }, { 'strategy': 'map', 'mapping': { 'partialValue': 'partials' } }, { 'success': 'urn:test:response-selection/end', 'error': 'urn:test:response-selection/end', 'empty': 'urn:test:response-selection/end' })
      .gather('urn:test:response-selection/error-gather', {
        'urn:test:response-selection/scatter': {},
      }, { 'strategy': 'map', 'mapping': { 'errorValue': 'errors' } }, { 'success': 'urn:test:response-selection/end', 'error': 'urn:test:response-selection/end', 'empty': 'urn:test:response-selection/end' })
      .terminal('urn:test:response-selection/end', { 'outcome': 'completed' })
      .entrypoints({ 'main': 'urn:test:response-selection/scatter' })
      .build();
    const scatter = dag.nodes[0];
    assert.ok(scatter !== undefined && scatter['@type'] === 'ScatterNode');
    const response = TransientResultSelection.scatterResponseState(
      scatter,
      new Map(dag.nodes.map((node) => [node['@id'], node])),
    );

    assert.deepEqual(response.outputSelections['success']?.domainPaths, ['successValue', 'partialValue']);
    assert.deepEqual(response.outputSelections['error']?.domainPaths, ['errorValue', 'partialValue']);
    assert.deepEqual(response.defaultSelection.domainPaths, []);
  });
});
