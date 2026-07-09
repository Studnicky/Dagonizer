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
import { Placement } from '../../src/entities/dag/Placement.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

const noop = TestNode.make<NodeStateBase>('urn:noocodec:node:noop', ['success']);
const DEFAULTS_DAG_IRI = 'urn:noocodec:dag:scatter-defaults';
const DEFAULTS_FAN_IRI = 'urn:noocodec:dag:scatter-defaults/node/fan';
const DEFAULTS_END_IRI = 'urn:noocodec:dag:scatter-defaults/node/end';
const CUSTOM_DAG_IRI = 'urn:noocodec:dag:scatter-custom';
const CUSTOM_FAN_IRI = 'urn:noocodec:dag:scatter-custom/node/fan';
const CUSTOM_END_IRI = 'urn:noocodec:dag:scatter-custom/node/end';
const NO_OPTIONALS_DAG_IRI = 'urn:noocodec:dag:scatter-no-optionals';
const NO_OPTIONALS_FAN_IRI = 'urn:noocodec:dag:scatter-no-optionals/node/fan';
const NO_OPTIONALS_END_IRI = 'urn:noocodec:dag:scatter-no-optionals/node/end';
const NO_CONTAINER_DAG_IRI = 'urn:noocodec:dag:scatter-no-container';
const NO_CONTAINER_FAN_IRI = 'urn:noocodec:dag:scatter-no-container/node/fan';
const NO_CONTAINER_END_IRI = 'urn:noocodec:dag:scatter-no-container/node/end';
const GATHER_DEFAULT_DAG_IRI = 'urn:noocodec:dag:scatter-gather-default';
const GATHER_DEFAULT_FAN_IRI = 'urn:noocodec:dag:scatter-gather-default/node/fan';
const GATHER_DEFAULT_END_IRI = 'urn:noocodec:dag:scatter-gather-default/node/end';
const BUILDER_CHECK_DAG_IRI = 'urn:noocodec:dag:scatter-builder-check';
const BUILDER_CHECK_FAN_OUT_IRI = 'urn:noocodec:dag:scatter-builder-check/node/fan-out';
const BUILDER_CHECK_END_IRI = 'urn:noocodec:dag:scatter-builder-check/node/end';
const RESERVOIR_PRESENT_DAG_IRI = 'urn:noocodec:dag:scatter-reservoir-present';
const RESERVOIR_PRESENT_FAN_IRI = 'urn:noocodec:dag:scatter-reservoir-present/node/fan';
const RESERVOIR_PRESENT_END_IRI = 'urn:noocodec:dag:scatter-reservoir-present/node/end';
const RESERVOIR_NO_IDLE_DAG_IRI = 'urn:noocodec:dag:scatter-reservoir-no-idle';
const RESERVOIR_NO_IDLE_FAN_IRI = 'urn:noocodec:dag:scatter-reservoir-no-idle/node/fan';
const RESERVOIR_NO_IDLE_END_IRI = 'urn:noocodec:dag:scatter-reservoir-no-idle/node/end';
const NO_RESERVOIR_DAG_IRI = 'urn:noocodec:dag:scatter-no-reservoir';
const NO_RESERVOIR_FAN_IRI = 'urn:noocodec:dag:scatter-no-reservoir/node/fan';
const NO_RESERVOIR_END_IRI = 'urn:noocodec:dag:scatter-no-reservoir/node/end';

void describe('ScatterOptions.resolve — static factory', () => {
  void it('fills itemKey and reducer with their default constants when omitted', () => {
    const resolved = ScatterOptions.resolve({});
    assert.equal(resolved.itemKey, SCATTER_ITEM_KEY_DEFAULT);
    assert.equal(resolved.itemKey, 'currentItem');
    assert.equal(resolved.reducer, SCATTER_REDUCER_DEFAULT);
    assert.equal(resolved.reducer, 'aggregate');
  });

  void it('preserves caller-supplied itemKey and reducer', () => {
    const resolved = ScatterOptions.resolve({
      'itemKey': 'task',
      'reducer': 'any-success',
    });
    assert.equal(resolved.itemKey, 'task');
    assert.equal(resolved.reducer, 'any-success');
  });

  void it('leaves execution, inputs, and container absent when omitted', () => {
    const resolved = ScatterOptions.resolve({});
    assert.equal(resolved.execution, undefined);
    assert.equal(resolved.inputs, undefined);
    assert.equal(resolved.container, undefined);
  });
});

void describe('DAGBuilder.scatter — placement defaults', () => {
  void it('emits itemKey=currentItem and reducer=aggregate on produced ScatterNode when caller omits them', () => {
    const dag = new DAGBuilder(DEFAULTS_DAG_IRI, '1', { 'name': 'defaults' })
      .scatter(DEFAULTS_FAN_IRI, 'items', noop, {
        'all-success': DEFAULTS_END_IRI,
        'all-error': DEFAULTS_END_IRI,
        'partial': DEFAULTS_END_IRI,
        'empty': DEFAULTS_END_IRI,
      }, { 'name': 'fan' })
      .terminal(DEFAULTS_END_IRI, { 'name': 'end' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present');
    assert.equal(scatterNode.itemKey, 'currentItem');
    assert.equal(scatterNode.reducer, 'aggregate');
  });

  void it('emits caller-supplied itemKey and reducer unchanged', () => {
    const dag = new DAGBuilder(CUSTOM_DAG_IRI, '1', { 'name': 'custom' })
      .scatter(CUSTOM_FAN_IRI, 'items', noop, {
        'all-success': CUSTOM_END_IRI,
        'all-error': CUSTOM_END_IRI,
        'partial': CUSTOM_END_IRI,
        'empty': CUSTOM_END_IRI,
      }, {
        'itemKey': 'task',
        'reducer': 'any-success',
        'name': 'fan',
      })
      .terminal(CUSTOM_END_IRI, { 'name': 'end' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present');
    assert.equal(scatterNode.itemKey, 'task');
    assert.equal(scatterNode.reducer, 'any-success');
  });

  void it('omits execution, container, and stateMapping from produced ScatterNode when caller omits them', () => {
    // Node-body scatter omitting execution and inputs.
    const dag = new DAGBuilder(NO_OPTIONALS_DAG_IRI, '1', { 'name': 'no-optionals' })
      .scatter(NO_OPTIONALS_FAN_IRI, 'items', noop, {
        'all-success': NO_OPTIONALS_END_IRI,
        'all-error': NO_OPTIONALS_END_IRI,
        'partial': NO_OPTIONALS_END_IRI,
        'empty': NO_OPTIONALS_END_IRI,
      }, { 'name': 'fan' })
      .terminal(NO_OPTIONALS_END_IRI, { 'name': 'end' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present');
    assert.equal('execution' in scatterNode, false, 'execution absent when not provided');
    assert.equal('stateMapping' in scatterNode, false, 'stateMapping absent when inputs not provided');

    // Dag-body scatter omitting container: container key must be absent.
    const dagBodyDag = new DAGBuilder(NO_CONTAINER_DAG_IRI, '1', { 'name': 'no-container' })
      .scatter(NO_CONTAINER_FAN_IRI, 'items', { 'dag': 'urn:noocodec:dag:child' }, {
        'all-success': NO_CONTAINER_END_IRI,
        'all-error': NO_CONTAINER_END_IRI,
        'partial': NO_CONTAINER_END_IRI,
        'empty': NO_CONTAINER_END_IRI,
      }, { 'name': 'fan' })
      .terminal(NO_CONTAINER_END_IRI, { 'name': 'end' })
      .build();

    const dagBodyScatter = dagBodyDag.nodes.find(Placement.isScatter);
    assert.ok(dagBodyScatter !== undefined, 'ScatterNode present');
    assert.equal('container' in dagBodyScatter, false, 'container absent when not provided');
  });

  void it('emits no gather contract on produced ScatterNode', () => {
    const dag = new DAGBuilder(GATHER_DEFAULT_DAG_IRI, '1', { 'name': 'gather-default' })
      .scatter(GATHER_DEFAULT_FAN_IRI, 'items', noop, {
        'all-success': GATHER_DEFAULT_END_IRI,
        'all-error': GATHER_DEFAULT_END_IRI,
        'partial': GATHER_DEFAULT_END_IRI,
        'empty': GATHER_DEFAULT_END_IRI,
      }, { 'name': 'fan' })
      .terminal(GATHER_DEFAULT_END_IRI, { 'name': 'end' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present');
    assert.equal('gather' in scatterNode, false);
  });

  void it('emits a well-formed ScatterNode for a descriptor source with a node body', () => {
    const dag = new DAGBuilder(BUILDER_CHECK_DAG_IRI, '1.0', { 'name': 'builder-check' })
      .scatter(BUILDER_CHECK_FAN_OUT_IRI, 'providers', noop, {
        'success': BUILDER_CHECK_END_IRI,
        'error':   BUILDER_CHECK_END_IRI,
        'empty':   BUILDER_CHECK_END_IRI,
      }, {
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'reducer': 'any-success',
        'name': 'fan-out',
      })
      .terminal(BUILDER_CHECK_END_IRI, { 'name': 'end', 'outcome': 'completed' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present in built DAG');
    assert.equal(scatterNode.name, 'fan-out');
    // body is a node reference (the noop node).
    assert.ok('node' in scatterNode.body, 'body is a node reference');
    if (!('node' in scatterNode.body)) throw new Error('unreachable — asserted above');
    assert.equal(scatterNode.body.node, 'urn:noocodec:node:noop');
    assert.equal(scatterNode.source, 'providers');
    assert.ok(scatterNode.execution !== undefined && scatterNode.execution.mode === 'item', 'execution is item mode');
    assert.equal(scatterNode.execution?.concurrency, 4);
    assert.equal('gather' in scatterNode, false);
    assert.equal(scatterNode.reducer, 'any-success');
  });
});

void describe('DAGBuilder.scatter — execution.reservoir option', () => {
  void it('emits execution.reservoir verbatim on ScatterNode when caller supplies it', () => {
    const dag = new DAGBuilder(RESERVOIR_PRESENT_DAG_IRI, '1', { 'name': 'reservoir-present' })
      .scatter(RESERVOIR_PRESENT_FAN_IRI, 'items', noop,
        {
          'all-success': RESERVOIR_PRESENT_END_IRI,
          'all-error': RESERVOIR_PRESENT_END_IRI,
          'partial': RESERVOIR_PRESENT_END_IRI,
          'empty': RESERVOIR_PRESENT_END_IRI,
        },
        {
          'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'user.id', 'capacity': 100, 'idleMs': 500 } },
          'name': 'fan',
        })
      .terminal(RESERVOIR_PRESENT_END_IRI, { 'name': 'end' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present');
    assert.ok(scatterNode.execution !== undefined && scatterNode.execution.mode === 'reservoir', 'execution is reservoir mode');
    const reservoir = scatterNode.execution.reservoir;
    assert.equal(reservoir.keyField, 'user.id');
    assert.equal(reservoir.capacity, 100);
    assert.equal(reservoir.idleMs, 500);
  });

  void it('emits execution.reservoir without idleMs when caller omits it', () => {
    const dag = new DAGBuilder(RESERVOIR_NO_IDLE_DAG_IRI, '1', { 'name': 'reservoir-no-idle' })
      .scatter(RESERVOIR_NO_IDLE_FAN_IRI, 'items', noop,
        {
          'all-success': RESERVOIR_NO_IDLE_END_IRI,
          'all-error': RESERVOIR_NO_IDLE_END_IRI,
          'partial': RESERVOIR_NO_IDLE_END_IRI,
          'empty': RESERVOIR_NO_IDLE_END_IRI,
        },
        {
          'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'tenantId', 'capacity': 50 } },
          'name': 'fan',
        })
      .terminal(RESERVOIR_NO_IDLE_END_IRI, { 'name': 'end' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present');
    assert.ok(scatterNode.execution !== undefined && scatterNode.execution.mode === 'reservoir', 'execution is reservoir mode');
    const reservoir = scatterNode.execution.reservoir;
    assert.equal(reservoir.keyField, 'tenantId');
    assert.equal(reservoir.capacity, 50);
    assert.equal('idleMs' in reservoir, false, 'idleMs absent when not provided');
  });

  void it('execution absent from ScatterNode when caller omits it (wire-identical to pre-execution shape)', () => {
    const dag = new DAGBuilder(NO_RESERVOIR_DAG_IRI, '1', { 'name': 'no-reservoir' })
      .scatter(NO_RESERVOIR_FAN_IRI, 'items', noop,
        {
          'all-success': NO_RESERVOIR_END_IRI,
          'all-error': NO_RESERVOIR_END_IRI,
          'partial': NO_RESERVOIR_END_IRI,
          'empty': NO_RESERVOIR_END_IRI,
        },
        { 'name': 'fan' })
      .terminal(NO_RESERVOIR_END_IRI, { 'name': 'end' })
      .build();

    const scatterNode = dag.nodes.find(Placement.isScatter);
    assert.ok(scatterNode !== undefined, 'ScatterNode present');
    assert.equal('execution' in scatterNode, false, 'execution key absent when not provided');
  });

  void it('Validator.scatterNode accepts a scatter with execution.mode reservoir', () => {
    const node = {
      '@id': 'urn:noocodec:dag:test/node/fan',
      '@type':   'ScatterNode',
      'name':    'fan',
      'source':  'items',
      'body': { 'node': 'urn:noocodec:node:worker' },
      'outputs': { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
      'itemKey': 'currentItem',
      'reducer': 'aggregate',
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'user.id', 'capacity': 10 } },
    };
    // Must not throw.
    const result = Validator.scatterNode.validate(node);
    assert.ok(result !== undefined, 'validated ScatterNode returned');
    assert.equal(result['@type'], 'ScatterNode');
  });

  void it('Validator.scatterNode rejects a reservoir with capacity 0', () => {
    const node = {
      '@id': 'urn:noocodec:dag:test/node/fan',
      '@type':   'ScatterNode',
      'name':    'fan',
      'source':  'items',
      'body': { 'node': 'urn:noocodec:node:worker' },
      'outputs': { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
      'itemKey': 'currentItem',
      'reducer': 'aggregate',
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'user.id', 'capacity': 0 } },
    };
    assert.throws(
      () => Validator.scatterNode.validate(node),
      (err) => err instanceof Error && err.message.includes('capacity'),
    );
  });

  void it('Validator.scatterNode rejects execution with both throttle and reservoir (schema structurally forbids the combination)', () => {
    const node = {
      '@id': 'urn:noocodec:dag:test/node/fan',
      '@type':   'ScatterNode',
      'name':    'fan',
      'source':  'items',
      'body': { 'node': 'urn:noocodec:node:worker' },
      'outputs': { 'all-success': 'end', 'all-error': 'end', 'partial': 'end', 'empty': 'end' },
      'itemKey': 'currentItem',
      'reducer': 'aggregate',
      'execution': {
        'mode': 'reservoir',
        'reservoir': { 'keyField': 'user.id', 'capacity': 10 },
        'throttle': { 'concurrencyLimit': 2 },
      },
    };
    assert.throws(() => Validator.scatterNode.validate(node));
  });
});
