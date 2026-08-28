import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { WritePointType } from '../../src/contracts/WritePoint.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DagConfiguration } from '../../src/entities/configuration/DagConfiguration.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestNode } from '../_support/TestNode.js';

void describe('DagConfiguration', () => {
  void it('resolves canonical defaults', () => {
    assert.deepEqual(DagConfiguration.resolve(), DagConfiguration.DEFAULT);
  });

  void it('resolves placement over DAG over global over canonical defaults', () => {
    const resolved = DagConfiguration.resolve(
      {
        'execution': { 'batching': { 'mode': 'reservoir', 'concurrency': 2, 'reservoir': { 'keyField': 'kind' } } },
        'durability': { 'writePoints': ['NodeEdges'], 'foldJournalStoreKey': 'global' },
      },
      {
        'execution': { 'batching': { 'concurrency': 4, 'reservoir': { 'capacity': 50 } } },
        'durability': { 'foldJournalStoreKey': 'dag' },
      },
      {
        'execution': { 'batching': { 'concurrency': 8, 'reservoir': { 'idleMs': 250 } } },
      },
    );

    assert.deepEqual(resolved.execution.batching, {
      'mode': 'reservoir',
      'concurrency': 8,
      'throttle': null,
      'reservoir': { 'keyField': 'kind', 'capacity': 50, 'idleMs': 250 },
    });
    assert.deepEqual(resolved.durability, {
      'writePoints': ['NodeEdges'],
      'foldJournalStoreKey': 'dag',
    });
  });

  void it('replaces inherited arrays including an explicit empty array', () => {
    const resolved = DagConfiguration.resolve(
      { 'durability': { 'writePoints': ['NodeEdges', 'WatermarkCommit'] } },
      undefined,
      { 'durability': { 'writePoints': [] } },
    );
    assert.deepEqual(resolved.durability.writePoints, []);
  });

  void it('rejects duplicate write-point enum values at the contract boundary', () => {
    const dag = new DAGBuilder('urn:noocodec:dag:duplicate-write-points', '1', {
      'configuration': { 'durability': { 'writePoints': ['NodeEdges', 'NodeEdges'] } },
    })
      .terminal('urn:noocodec:dag:duplicate-write-points/node/end')
      .build();

    assert.equal(Validator.dag.is(dag), false);
  });

  void it('rejects invalid dispatcher-level configuration at construction', () => {
    assert.throws(
      () => new Dagonizer({
        'configuration': { 'execution': { 'batching': { 'concurrency': 0 } } },
      }),
      { 'message': /^Invalid DagConfiguration/u },
    );
    assert.throws(
      () => new Dagonizer({
        'configuration': { 'durability': { 'writePoints': ['NodeEdges', 'NodeEdges'] } },
      }),
      { 'message': /^Invalid DagConfiguration/u },
    );
  });

  void it('clears nullable inherited values with explicit null', () => {
    const resolved = DagConfiguration.resolve(
      {
        'execution': {
          'batching': {
            'throttle': { 'concurrencyLimit': 3 },
            'reservoir': { 'keyField': 'kind', 'capacity': 20, 'idleMs': 500 },
          },
        },
        'durability': { 'foldJournalStoreKey': 'global' },
      },
      {
        'execution': { 'batching': { 'throttle': null, 'reservoir': null } },
        'durability': { 'foldJournalStoreKey': null },
      },
    );

    assert.equal(resolved.execution.batching.throttle, null);
    assert.equal(resolved.execution.batching.reservoir, null);
    assert.equal(resolved.durability.foldJournalStoreKey, null);
  });

  void it('inherits nested throttle fields independently', () => {
    const resolved = DagConfiguration.resolve(
      { 'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 2, 'adaptive': { 'enabled': true } } } } },
      { 'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 5 } } } },
      { 'execution': { 'batching': { 'throttle': { 'adaptive': null } } } },
    );

    assert.deepEqual(resolved.execution.batching.throttle, {
      'concurrencyLimit': 5,
      'adaptive': null,
    });
  });

  void it('cascades adaptive fields independently across placement, DAG, and dispatcher tiers', () => {
    const resolved = DagConfiguration.resolve(
      {
        'execution': {
          'batching': {
            'throttle': {
              'concurrencyLimit': 2,
              'adaptive': {
                'enabled': true,
                'targetLatencyMs': 40,
                'minConcurrency': 2,
                'maxConcurrency': 20,
              },
            },
          },
        },
      },
      {
        'execution': {
          'batching': {
            'throttle': {
              'adaptive': {
                'enabled': true,
                'maxConcurrency': 12,
                'adjustmentInterval': 500,
              },
            },
          },
        },
      },
      {
        'execution': {
          'batching': {
            'throttle': {
              'adaptive': {
                'enabled': true,
                'sampleWindow': 8,
                'stepSize': 2,
              },
            },
          },
        },
      },
    );

    assert.deepEqual(resolved.execution.batching.throttle, {
      'concurrencyLimit': 2,
      'adaptive': {
        'enabled': true,
        'targetLatencyMs': 40,
        'minConcurrency': 2,
        'maxConcurrency': 12,
        'adjustmentInterval': 500,
        'sampleWindow': 8,
        'stepSize': 2,
      },
    });
  });

  void it('clears inherited adaptive fields with explicit null', () => {
    const resolved = DagConfiguration.resolve(
      {
        'execution': {
          'batching': {
            'throttle': {
              'concurrencyLimit': 2,
              'adaptive': { 'enabled': true, 'targetLatencyMs': 40, 'maxConcurrency': 20 },
            },
          },
        },
      },
      { 'execution': { 'batching': { 'throttle': { 'adaptive': null } } } },
      { 'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 5 } } } },
    );

    assert.deepEqual(resolved.execution.batching.throttle, {
      'concurrencyLimit': 5,
      'adaptive': null,
    });
  });

  void it('detaches and freezes adaptive policy and arrays from every caller tier', () => {
    const dispatcherAdaptive = { 'enabled': true, 'targetLatencyMs': 40, 'minConcurrency': 2 };
    const dagAdaptive = { 'enabled': true, 'maxConcurrency': 12 };
    const placementAdaptive = { 'enabled': true, 'sampleWindow': 8 };
    const writePoints: WritePointType[] = ['NodeEdges'];
    const dispatcherConfiguration = {
      'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 2, 'adaptive': dispatcherAdaptive } } },
      'durability': { writePoints },
    } satisfies DagConfiguration.InputType;
    const dagConfiguration = {
      'execution': { 'batching': { 'throttle': { 'adaptive': dagAdaptive } } },
    } satisfies DagConfiguration.InputType;
    const placementConfiguration = {
      'execution': { 'batching': { 'throttle': { 'adaptive': placementAdaptive } } },
    } satisfies DagConfiguration.InputType;
    const resolved = DagConfiguration.resolve(dispatcherConfiguration, dagConfiguration, placementConfiguration);

    dispatcherAdaptive.targetLatencyMs = 400;
    dagAdaptive.maxConcurrency = 24;
    placementAdaptive.sampleWindow = 16;
    writePoints.push('WatermarkCommit');

    assert.deepEqual(resolved.execution.batching.throttle, {
      'concurrencyLimit': 2,
      'adaptive': {
        'enabled': true,
        'targetLatencyMs': 40,
        'minConcurrency': 2,
        'maxConcurrency': 12,
        'sampleWindow': 8,
      },
    });
    assert.deepEqual(resolved.durability.writePoints, ['NodeEdges']);
    assert.equal(Object.isFrozen(resolved), true);
    assert.equal(Object.isFrozen(resolved.execution), true);
    assert.equal(Object.isFrozen(resolved.execution.batching), true);
    assert.equal(Object.isFrozen(resolved.execution.batching.throttle), true);
    assert.equal(Object.isFrozen(resolved.execution.batching.throttle?.adaptive), true);
    assert.equal(Object.isFrozen(resolved.durability), true);
    assert.equal(Object.isFrozen(resolved.durability.writePoints), true);
  });

  void it('reopens a reservoir above an intermediate null with canonical object defaults', () => {
    const resolved = DagConfiguration.resolve(
      { 'execution': { 'batching': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'global', 'capacity': 20, 'idleMs': 500 } } } },
      { 'execution': { 'batching': { 'reservoir': null } } },
      { 'execution': { 'batching': { 'reservoir': { 'keyField': 'placement' } } } },
    );

    assert.deepEqual(resolved.execution.batching.reservoir, {
      'keyField': 'placement',
      'capacity': 100,
      'idleMs': null,
    });
  });

  void it('reopens throttle above null without inheriting cleared fields', () => {
    const resolved = DagConfiguration.resolve(
      { 'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 2, 'adaptive': { 'enabled': true } } } } },
      { 'execution': { 'batching': { 'throttle': null } } },
      { 'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 5 } } } },
    );

    assert.deepEqual(resolved.execution.batching.throttle, {
      'concurrencyLimit': 5,
      'adaptive': null,
    });
    assert.throws(
      () => DagConfiguration.resolve(
        { 'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 2 } } } },
        { 'execution': { 'batching': { 'throttle': null } } },
        { 'execution': { 'batching': { 'throttle': {} } } },
      ),
      /requires concurrencyLimit/u,
    );
  });

  void it('rejects invalid nested DAG and scatter configuration during direct registration', () => {
    const dagIri = 'urn:noocodec:dag:invalid-direct-configuration';
    const scatterIri = `${dagIri}/node/scatter`;
    const endIri = `${dagIri}/node/end`;
    const dispatcher = new Dagonizer();
    const dag = new DAGBuilder(dagIri, '1', {
      'configuration': { 'execution': { 'batching': { 'reservoir': { 'keyField': '', 'capacity': 0 } } } },
    })
      .scatter(scatterIri, 'items', { 'dag': dagIri }, {
        'all-success': endIri,
        'partial': endIri,
        'all-error': endIri,
        'empty': endIri,
      }, {
        'configuration': { 'execution': { 'batching': { 'throttle': { 'concurrencyLimit': 0 } } } },
      })
      .terminal(endIri)
      .build();

    assert.throws(() => dispatcher.registerDAG(dag), { 'message': /^Invalid DAG/u });
    assert.equal(dispatcher.getDAG(dagIri), undefined);
    assert.equal(dispatcher.getDagConfiguration(dagIri), undefined);
    assert.equal(dispatcher.getPlacementConfiguration(scatterIri), undefined);
  });

  void it('registers the dispatcher, DAG, and placement cascade as resolved policy', () => {
    const bodyDagIri = 'urn:noocodec:dag:configuration-cascade-body';
    const bodyNodeIri = 'urn:noocodec:node:configuration-cascade-body';
    const bodyPlacementIri = `${bodyDagIri}/node/body`;
    const bodyEndIri = `${bodyDagIri}/node/end`;
    const dagIri = 'urn:noocodec:dag:configuration-cascade';
    const scatterIri = `${dagIri}/node/scatter`;
    const endIri = `${dagIri}/node/end`;
    const bodyNode = TestNode.make(bodyNodeIri, ['success']);
    const dispatcherReservoir = { 'keyField': 'kind', 'capacity': 100, 'idleMs': 500 };
    const dagReservoir = { 'capacity': 50 };
    const placementReservoir = { 'idleMs': 250 };
    const dispatcherWritePoints: WritePointType[] = ['NodeEdges'];
    const placementWritePoints: WritePointType[] = [];
    const dispatcherConfiguration = {
      'execution': {
        'batching': {
          'mode': 'reservoir',
          'concurrency': 2,
          'reservoir': dispatcherReservoir,
        },
      },
      'durability': { 'writePoints': dispatcherWritePoints },
    } satisfies DagConfiguration.InputType;
    const dagConfiguration = {
      'execution': { 'batching': { 'concurrency': 4, 'reservoir': dagReservoir } },
    } satisfies DagConfiguration.InputType;
    const placementConfiguration = {
      'execution': { 'batching': { 'concurrency': 8, 'reservoir': placementReservoir } },
      'durability': { 'writePoints': placementWritePoints },
    } satisfies DagConfiguration.InputType;
    const dispatcher = new Dagonizer({
      'configuration': dispatcherConfiguration,
    });

    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(new DAGBuilder(bodyDagIri, '1')
      .node(bodyPlacementIri, bodyNode, { 'success': bodyEndIri })
      .terminal(bodyEndIri)
      .build());
    dispatcher.registerDAG(new DAGBuilder(dagIri, '1', {
      'configuration': dagConfiguration,
    })
      .scatter(scatterIri, 'items', { 'dag': bodyDagIri }, {
        'all-success': endIri,
        'partial': endIri,
        'all-error': endIri,
        'empty': endIri,
      }, {
        'configuration': placementConfiguration,
      })
      .terminal(endIri)
      .build());

    dispatcherReservoir.keyField = 'mutated';
    dispatcherReservoir.idleMs = 1_000;
    dagReservoir.capacity = 5;
    placementReservoir.idleMs = 10;
    dispatcherWritePoints.push('WatermarkCommit');
    placementWritePoints.push('NodeEdges');

    assert.deepEqual(dispatcher.getDagConfiguration(dagIri), {
      'execution': {
        'batching': {
          'mode': 'reservoir',
          'concurrency': 4,
          'throttle': null,
          'reservoir': { 'keyField': 'kind', 'capacity': 50, 'idleMs': 500 },
        },
      },
      'durability': { 'writePoints': ['NodeEdges'], 'foldJournalStoreKey': null },
    });
    assert.deepEqual(dispatcher.getPlacementConfiguration(scatterIri), {
      'execution': {
        'batching': {
          'mode': 'reservoir',
          'concurrency': 8,
          'throttle': null,
          'reservoir': { 'keyField': 'kind', 'capacity': 50, 'idleMs': 250 },
        },
      },
      'durability': { 'writePoints': [], 'foldJournalStoreKey': null },
    });
  });
});
