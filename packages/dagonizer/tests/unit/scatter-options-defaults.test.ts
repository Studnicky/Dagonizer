/**
 * scatter-options-defaults.test.ts
 *
 * Verifies that `DAGBuilder.scatter` materialises static defaults for `itemKey`
 * and `reducer` on the produced `ScatterNode` at build time, regardless of
 * whether the caller provides those fields.
 *
 * Also exercises the `ScatterOptions.from` factory directly to confirm the
 * default constants are applied and caller-supplied values are preserved.
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
import type { NodeOutputInterface } from '../../src/entities/node/NodeOutput.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

class NoopNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'noop';
  readonly outputs = ['success'] as const;
  protected async executeOne(): Promise<NodeOutputInterface<'success'>> { return { 'errors': [], 'output': 'success' as const }; }
}
const noop = new NoopNode();

void describe('ScatterOptions.from — static factory', () => {
  void it('fills itemKey with SCATTER_ITEM_KEY_DEFAULT when omitted', () => {
    const resolved = ScatterOptions.from({ 'gather': { 'strategy': 'discard' } });
    assert.equal(resolved.itemKey, SCATTER_ITEM_KEY_DEFAULT);
    assert.equal(resolved.itemKey, 'currentItem');
  });

  void it('fills reducer with SCATTER_REDUCER_DEFAULT when omitted', () => {
    const resolved = ScatterOptions.from({ 'gather': { 'strategy': 'discard' } });
    assert.equal(resolved.reducer, SCATTER_REDUCER_DEFAULT);
    assert.equal(resolved.reducer, 'aggregate');
  });

  void it('preserves caller-supplied itemKey', () => {
    const resolved = ScatterOptions.from({
      'itemKey': 'task',
      'gather':  { 'strategy': 'discard' },
    });
    assert.equal(resolved.itemKey, 'task');
  });

  void it('preserves caller-supplied reducer', () => {
    const resolved = ScatterOptions.from({
      'reducer': 'any-success',
      'gather':  { 'strategy': 'discard' },
    });
    assert.equal(resolved.reducer, 'any-success');
  });

  void it('leaves concurrency absent when omitted', () => {
    const resolved = ScatterOptions.from({ 'gather': { 'strategy': 'discard' } });
    assert.equal(resolved.concurrency, undefined);
  });

  void it('leaves inputs absent when omitted', () => {
    const resolved = ScatterOptions.from({ 'gather': { 'strategy': 'discard' } });
    assert.equal(resolved.inputs, undefined);
  });

  void it('leaves container absent when omitted', () => {
    const resolved = ScatterOptions.from({ 'gather': { 'strategy': 'discard' } });
    assert.equal(resolved.container, undefined);
  });
});

void describe('DAGBuilder.scatter — placement defaults', () => {
  void it('emits itemKey=currentItem on produced ScatterNode when caller omits itemKey', () => {
    const dag = new DAGBuilder('defaults-itemkey', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal((scatter as Record<string, unknown>)['itemKey'], 'currentItem');
  });

  void it('emits reducer=aggregate on produced ScatterNode when caller omits reducer', () => {
    const dag = new DAGBuilder('defaults-reducer', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal((scatter as Record<string, unknown>)['reducer'], 'aggregate');
  });

  void it('emits caller-supplied itemKey unchanged', () => {
    const dag = new DAGBuilder('custom-itemkey', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'itemKey': 'task',
        'gather':  { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal((scatter as Record<string, unknown>)['itemKey'], 'task');
  });

  void it('emits caller-supplied reducer unchanged', () => {
    const dag = new DAGBuilder('custom-reducer', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'reducer': 'any-success',
        'gather':  { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal((scatter as Record<string, unknown>)['reducer'], 'any-success');
  });

  void it('concurrency is absent from produced ScatterNode when caller omits it', () => {
    const dag = new DAGBuilder('no-concurrency', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal('concurrency' in scatter, false, 'concurrency absent when not provided');
  });

  void it('container is absent from produced ScatterNode when caller omits it', () => {
    const dag = new DAGBuilder('no-container', '1')
      .scatter('fan', 'items', { 'dag': 'child' }, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal('container' in scatter, false, 'container absent when not provided');
  });

  void it('stateMapping absent from produced ScatterNode when caller omits inputs', () => {
    const dag = new DAGBuilder('no-inputs', '1')
      .scatter('fan', 'items', noop, { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const scatter = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatter !== undefined, 'ScatterNode present');
    assert.equal('stateMapping' in scatter, false, 'stateMapping absent when inputs not provided');
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
