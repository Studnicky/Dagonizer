/**
 * scatter-options-defaults.test.ts
 *
 * Verifies that `DAGBuilder.scatter` materialises static defaults for `itemKey`
 * and `reducer` on the produced `ScatterNode` at build time, regardless of
 * whether the caller provides those fields, and that the builder emits a
 * well-formed ScatterNode (including the full descriptor-source shape).
 *
 * Also exercises the `ScatterOptions.resolve` factory directly to confirm the
 * default constants are applied and caller-supplied values are preserved, and
 * the reservoir option round-trips through the builder and the validator.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import {
  SCATTER_ITEM_KEY_DEFAULT,
  SCATTER_REDUCER_DEFAULT,
  ScatterOptions,
} from '../../src/builder/ScatterOptions.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

class NoopNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'noop';
  readonly outputs = ['success'] as const;
  protected async executeOne(): Promise<NodeOutputType<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
}
const noop = new NoopNode();

void describe('ScatterOptions.resolve — static factory', () => {
  void it('fills itemKey and reducer with their default constants when omitted', () => {
    const resolved = ScatterOptions.resolve({ 'gather': { 'strategy': 'discard' } });
    assert.equal(resolved.itemKey, SCATTER_ITEM_KEY_DEFAULT);
    assert.equal(resolved.itemKey, 'currentItem');
    assert.equal(resolved.reducer, SCATTER_REDUCER_DEFAULT);
    assert.equal(resolved.reducer, 'aggregate');
  });

  void it('preserves caller-supplied itemKey and reducer', () => {
    const resolved = ScatterOptions.resolve({
      'itemKey': 'task',
      'reducer': 'any-success',
      'gather':  { 'strategy': 'discard' },
    });
    assert.equal(resolved.itemKey, 'task');
    assert.equal(resolved.reducer, 'any-success');
  });

  void it('leaves concurrency, inputs, and container absent when omitted', () => {
    const resolved = ScatterOptions.resolve({ 'gather': { 'strategy': 'discard' } });
    assert.equal(resolved.concurrency, undefined);
    assert.equal(resolved.inputs, undefined);
    assert.equal(resolved.container, undefined);
  });
});

void describe('DAGBuilder.scatter — placement defaults', () => {
  void it('emits itemKey=currentItem and reducer=aggregate on produced ScatterNode when caller omits them', () => {
    const dag = new DAGBuilder('defaults', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal((scatter as Record<string, unknown>)['itemKey'], 'currentItem');
    assert.equal((scatter as Record<string, unknown>)['reducer'], 'aggregate');
  });

  void it('emits caller-supplied itemKey and reducer unchanged', () => {
    const dag = new DAGBuilder('custom', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'itemKey': 'task',
        'reducer': 'any-success',
        'gather':  { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal((scatter as Record<string, unknown>)['itemKey'], 'task');
    assert.equal((scatter as Record<string, unknown>)['reducer'], 'any-success');
  });

  void it('omits concurrency, container, and stateMapping from produced ScatterNode when caller omits them', () => {
    // Node-body scatter omitting concurrency and inputs.
    const dag = new DAGBuilder('no-optionals', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal('concurrency' in scatter, false, 'concurrency absent when not provided');
    assert.equal('stateMapping' in scatter, false, 'stateMapping absent when inputs not provided');

    // Dag-body scatter omitting container: container key must be absent.
    const dagBodyDag = new DAGBuilder('no-container', '1')
      .scatter('fan', 'items', { 'dag': 'child' }, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const dagBodyScatter = dagBodyDag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(dagBodyScatter !== undefined, 'ScatterNode present');
    assert.equal('container' in dagBodyScatter, false, 'container absent when not provided');
  });

  void it('emits a well-formed ScatterNode for a descriptor source with a node body', () => {
    const dag = new DAGBuilder('builder-check', '1.0')
      .scatter('fan-out', 'providers', noop, {
        'success': 'end',
        'error':   'end',
        'empty':   'end',
      }, {
        'concurrency': 4,
        'gather':  { 'strategy': 'discard' },
        'reducer': 'any-success',
      })
      .terminal('end', { 'outcome': 'completed' })
      .build();

    const scatterNode = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatterNode !== undefined, 'ScatterNode present in built DAG');
    assert.equal(scatterNode.name, 'fan-out');
    // body is a node reference (the noop node).
    assert.ok('node' in scatterNode.body, 'body is a node reference');
    assert.equal((scatterNode.body as { node: string }).node, 'noop');
    assert.equal(scatterNode.source, 'providers');
    assert.equal(scatterNode.concurrency, 4);
    assert.equal(scatterNode.gather.strategy, 'discard');
    assert.equal(scatterNode.reducer, 'any-success');
  });
});

void describe('DAGBuilder.scatter — reservoir option', () => {
  void it('emits reservoir verbatim on ScatterNode when caller supplies it', () => {
    const dag = new DAGBuilder('reservoir-present', '1')
      .scatter('fan', 'items', noop,
        { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
        {
          'gather':    { 'strategy': 'discard' },
          'reservoir': { 'keyField': 'user.id', 'capacity': 100, 'idleMs': 500 },
        })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode') as Record<string, unknown>;
    assert.ok(scatter !== undefined, 'ScatterNode present');
    const reservoir = scatter['reservoir'] as Record<string, unknown>;
    assert.ok(reservoir !== undefined, 'reservoir present');
    assert.equal(reservoir['keyField'], 'user.id');
    assert.equal(reservoir['capacity'], 100);
    assert.equal(reservoir['idleMs'], 500);
  });

  void it('emits reservoir without idleMs when caller omits it', () => {
    const dag = new DAGBuilder('reservoir-no-idle', '1')
      .scatter('fan', 'items', noop,
        { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
        {
          'gather':    { 'strategy': 'discard' },
          'reservoir': { 'keyField': 'tenantId', 'capacity': 50 },
        })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode') as Record<string, unknown>;
    assert.ok(scatter !== undefined, 'ScatterNode present');
    const reservoir = scatter['reservoir'] as Record<string, unknown>;
    assert.ok(reservoir !== undefined, 'reservoir present');
    assert.equal(reservoir['keyField'], 'tenantId');
    assert.equal(reservoir['capacity'], 50);
    assert.equal('idleMs' in reservoir, false, 'idleMs absent when not provided');
  });

  void it('reservoir absent from ScatterNode when caller omits it (wire-identical to pre-reservoir shape)', () => {
    const dag = new DAGBuilder('no-reservoir', '1')
      .scatter('fan', 'items', noop,
        { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
        { 'gather': { 'strategy': 'discard' } })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal('reservoir' in scatter, false, 'reservoir key absent when not provided');
  });

  void it('Validator.scatterNode accepts a scatter with a reservoir', () => {
    const node = {
      '@id':     'urn:noocodex:dag:test/node/fan',
      '@type':   'ScatterNode',
      'name':    'fan',
      'source':  'items',
      'body':    { 'node': 'worker' },
      'gather':  { 'strategy': 'discard' },
      'outputs': { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
      'itemKey': 'currentItem',
      'reducer': 'aggregate',
      'reservoir': { 'keyField': 'user.id', 'capacity': 10 },
    };
    // Must not throw.
    const result = Validator.scatterNode.validate(node);
    assert.ok(result !== undefined, 'validated ScatterNode returned');
    assert.equal((result as Record<string, unknown>)['@type'], 'ScatterNode');
  });

  void it('Validator.scatterNode rejects a reservoir with capacity 0', () => {
    const node = {
      '@id':     'urn:noocodex:dag:test/node/fan',
      '@type':   'ScatterNode',
      'name':    'fan',
      'source':  'items',
      'body':    { 'node': 'worker' },
      'gather':  { 'strategy': 'discard' },
      'outputs': { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
      'itemKey': 'currentItem',
      'reducer': 'aggregate',
      'reservoir': { 'keyField': 'user.id', 'capacity': 0 },
    };
    assert.throws(
      () => Validator.scatterNode.validate(node),
      (err) => err instanceof Error && err.message.includes('capacity'),
    );
  });
});
