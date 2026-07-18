/**
 * scatter-execution-policy: proves the unified batching configuration
 * correctly gates concurrency in both modes.
 *
 * - `DagConfiguration.resolve` resolves the dispatcher/DAG/placement cascade.
 * - `mode: 'item'` — `execution.concurrency` caps peak concurrently in-flight
 *   CLONE bodies (item-level `Semaphore`), end-to-end through `Dagonizer.execute`.
 * - `mode: 'reservoir'` — `execution.concurrency` caps peak concurrently
 *   in-flight BATCH dispatches (the same `Semaphore` concept applied at batch
 *   granularity), proving `concurrency` still applies when reservoir mode is
 *   active rather than being silently ignored.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Dagonizer } from '../../src/Dagonizer.js';
import { DagConfiguration } from '../../src/entities/configuration/DagConfiguration.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

const placementIri = TestDag.placementIri;

// ─── DagConfiguration.resolve — unit-level cascade resolution ────────────────

void describe('DagConfiguration.resolve', () => {
  const ADAPTIVE_THROTTLE = {
    'enabled': true,
    'targetLatencyMs': 50,
    'minConcurrency': 1,
    'maxConcurrency': 4,
    'sampleWindow': 3,
    'adjustmentInterval': 1,
    'scaleUpThreshold': 0.8,
    'scaleDownThreshold': 1.2,
    'stepSize': 1,
  } as const;

  void it('resolves to item mode, concurrency 1, throttle null when batching configuration is absent', () => {
    const policy = DagConfiguration.resolve().execution.batching;
    assert.deepEqual(policy, { 'mode': 'item', 'concurrency': 1, 'throttle': null, 'reservoir': null });
  });

  void it('resolves item mode concurrency default (1) when execution.batching.mode is item with no concurrency', () => {
    const policy = DagConfiguration.resolve(undefined, undefined, { 'execution': { 'batching': { 'mode': 'item' } } }).execution.batching;
    assert.deepEqual(policy, { 'mode': 'item', 'concurrency': 1, 'throttle': null, 'reservoir': null });
  });

  void it('preserves caller-supplied item-mode concurrency and throttle', () => {
    const policy = DagConfiguration.resolve(undefined, undefined, {
      'execution': { 'batching': { 'mode': 'item', 'concurrency': 8, 'throttle': { 'concurrencyLimit': 2 } } },
    }).execution.batching;
    assert.deepEqual(policy, { 'mode': 'item', 'concurrency': 8, 'throttle': { 'concurrencyLimit': 2, 'adaptive': null }, 'reservoir': null });
  });

  void it('preserves caller-supplied adaptive throttle tuning', () => {
    const policy = DagConfiguration.resolve(undefined, undefined, {
      'execution': { 'batching': {
        'mode': 'item',
        'concurrency': 8,
        'throttle': { 'concurrencyLimit': 2, 'adaptive': ADAPTIVE_THROTTLE },
      } },
    }).execution.batching;
    assert.deepEqual(policy, {
      'mode': 'item',
      'concurrency': 8,
      'throttle': { 'concurrencyLimit': 2, 'adaptive': ADAPTIVE_THROTTLE },
      'reservoir': null,
    });
  });

  void it('resolves reservoir mode with concurrency default (1) and idleMs null when absent', () => {
    const policy = DagConfiguration.resolve(undefined, undefined, {
      'execution': { 'batching': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'k', 'capacity': 5 } } },
    }).execution.batching;
    assert.deepEqual(policy, {
      'mode': 'reservoir',
      'concurrency': 1,
      'throttle': null,
      'reservoir': { 'keyField': 'k', 'capacity': 5, 'idleMs': null },
    });
  });

  void it('preserves caller-supplied reservoir-mode concurrency and idleMs', () => {
    const policy = DagConfiguration.resolve(undefined, undefined, {
      'execution': { 'batching': { 'mode': 'reservoir', 'concurrency': 3, 'reservoir': { 'keyField': 'k', 'capacity': 5, 'idleMs': 100 } } },
    }).execution.batching;
    assert.deepEqual(policy, {
      'mode': 'reservoir',
      'concurrency': 3,
      'throttle': null,
      'reservoir': { 'keyField': 'k', 'capacity': 5, 'idleMs': 100 },
    });
  });
});

// ─── mode: 'item' — execution.concurrency caps peak in-flight clone bodies ──

class ItemsState extends NodeStateBase {
  items: number[] = [];


}

class ItemModeDag {
  private constructor() {}

  static of(dagIri: string, name: string, concurrency: number): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoints': { 'main': placementIri(dagIri, 'fan') },
      'nodes': [
        {
          '@id': placementIri(dagIri, 'fan'),
          '@type':     'ScatterNode',
          'name':      'fan',
          'body':      { 'node': 'urn:noocodec:node:worker' },
          'source':    'items',
          'itemKey':   'item',
          'configuration': { 'execution': { 'batching': { 'mode': 'item', 'concurrency': concurrency } } },
          'outputs': {
            'all-success': placementIri(dagIri, 'end'),
            'partial': placementIri(dagIri, 'end'),
            'all-error': placementIri(dagIri, 'end'),
            'empty': placementIri(dagIri, 'end'),
          },
        },
        { '@id': placementIri(dagIri, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
  }
}

void describe('Scatter execution policy — mode: item caps concurrently in-flight clones', () => {
  void it('peak concurrently executing clone bodies never exceeds execution.concurrency', async () => {
    const dispatcher = new Dagonizer<ItemsState>();
    let inFlight = 0;
    let peak = 0;

    dispatcher.registerNode(TestNode.make<ItemsState>('urn:noocodec:node:worker', ['success'], async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight--;
      return 'success';
    }));
    dispatcher.registerDAG(ItemModeDag.of('urn:noocodec:dag:item-mode-cap', 'item-mode-cap', 3));

    const state = new ItemsState();
    state.items = [1, 2, 3, 4, 5, 6, 7, 8];
    await dispatcher.execute('urn:noocodec:dag:item-mode-cap', state);

    assert.ok(peak <= 3, `peak in-flight clones was ${peak}, expected <= 3`);
    assert.ok(peak > 1, `peak in-flight clones was ${peak}, expected concurrency to actually parallelize (> 1)`);
  });
});

// ─── mode: 'reservoir' — execution.concurrency caps peak in-flight batches ──

class BatchState extends NodeStateBase {
  events: { key: string; value: number }[] = [];


}

class ReservoirModeDag {
  private constructor() {}

  static of(dagIri: string, name: string, concurrency: number): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoints': { 'main': placementIri(dagIri, 'fan') },
      'nodes': [
        {
          '@id': placementIri(dagIri, 'fan'),
          '@type':     'ScatterNode',
          'name':      'fan',
          'body':      { 'node': 'urn:noocodec:node:batch-worker' },
          'source':    'events',
          'itemKey':   'item',
          'configuration': { 'execution': { 'batching': {
            'mode':       'reservoir',
            'concurrency': concurrency,
            // capacity: 1 → every item is its own batch, so 6 distinct keys
            // release 6 concurrently-dispatchable batches, letting the
            // concurrency cap actually bind.
            'reservoir': { 'keyField': 'key', 'capacity': 1 },
          } } },
          'outputs': {
            'all-success': placementIri(dagIri, 'end'),
            'partial': placementIri(dagIri, 'end'),
            'all-error': placementIri(dagIri, 'end'),
            'empty': placementIri(dagIri, 'end'),
          },
        },
        { '@id': placementIri(dagIri, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
  }
}

void describe('Scatter execution policy — mode: reservoir caps concurrently in-flight batches', () => {
  void it('peak concurrently executing batch dispatches never exceeds execution.concurrency (concurrency is NOT silently ignored under reservoir mode)', async () => {
    const dispatcher = new Dagonizer<BatchState>();
    let inFlight = 0;
    let peak = 0;

    dispatcher.registerNode(TestNode.make<BatchState>('urn:noocodec:node:batch-worker', ['success'], async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight--;
      return 'success';
    }));
    dispatcher.registerDAG(ReservoirModeDag.of('urn:noocodec:dag:reservoir-mode-cap', 'reservoir-mode-cap', 2));

    const state = new BatchState();
    // 6 distinct keys, capacity 1 → 6 independently-releasable batches.
    state.events = Array.from({ 'length': 6 }, (_, i) => ({ 'key': `k${i}`, 'value': i }));
    await dispatcher.execute('urn:noocodec:dag:reservoir-mode-cap', state);

    assert.ok(peak <= 2, `peak in-flight batches was ${peak}, expected <= 2`);
    assert.ok(peak > 1, `peak in-flight batches was ${peak}, expected concurrency to actually parallelize (> 1)`);
  });
});
