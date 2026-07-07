/**
 * scatter-execution-policy: proves the unified `ScatterNode.execution` policy
 * correctly gates concurrency in both modes.
 *
 * - `ScatterNodeDefaults.executionPolicy` resolves the documented defaults for
 *   absent/`item`/`reservoir` wire shapes (unit-level, no dispatcher run).
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
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import { ScatterNodeDefaults } from '../../src/entities/dag/ScatterNode.js';
import type { ScatterNodeType } from '../../src/entities/dag/ScatterNode.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

// ─── ScatterNodeDefaults.executionPolicy — unit-level default resolution ─────

void describe('ScatterNodeDefaults.executionPolicy', () => {
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

  const BASE: ScatterNodeType = {
    '@id':     'urn:noocodex:dag:x/node/fan',
    '@type':   'ScatterNode',
    'name':    'fan',
    'source':  'items',
    'body':    { 'node': 'worker' },
    'gather':  { 'strategy': 'discard' },
    'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
  };

  void it('resolves to item mode, concurrency 1, throttle null when execution is absent', () => {
    const policy = ScatterNodeDefaults.executionPolicy(BASE);
    assert.deepEqual(policy, { 'mode': 'item', 'concurrency': 1, 'throttle': null });
  });

  void it('resolves item mode concurrency default (1) when execution.mode is item with no concurrency', () => {
    const policy = ScatterNodeDefaults.executionPolicy({ ...BASE, 'execution': { 'mode': 'item' } });
    assert.deepEqual(policy, { 'mode': 'item', 'concurrency': 1, 'throttle': null });
  });

  void it('preserves caller-supplied item-mode concurrency and throttle', () => {
    const policy = ScatterNodeDefaults.executionPolicy({
      ...BASE,
      'execution': { 'mode': 'item', 'concurrency': 8, 'throttle': { 'concurrencyLimit': 2 } },
    });
    assert.deepEqual(policy, { 'mode': 'item', 'concurrency': 8, 'throttle': { 'concurrencyLimit': 2 } });
  });

  void it('preserves caller-supplied adaptive throttle tuning', () => {
    const policy = ScatterNodeDefaults.executionPolicy({
      ...BASE,
      'execution': {
        'mode': 'item',
        'concurrency': 8,
        'throttle': { 'concurrencyLimit': 2, 'adaptive': ADAPTIVE_THROTTLE },
      },
    });
    assert.deepEqual(policy, {
      'mode': 'item',
      'concurrency': 8,
      'throttle': { 'concurrencyLimit': 2, 'adaptive': ADAPTIVE_THROTTLE },
    });
  });

  void it('resolves reservoir mode with concurrency default (1) and idleMs null when absent', () => {
    const policy = ScatterNodeDefaults.executionPolicy({
      ...BASE,
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'k', 'capacity': 5 } },
    });
    assert.deepEqual(policy, {
      'mode': 'reservoir',
      'concurrency': 1,
      'reservoir': { 'keyField': 'k', 'capacity': 5, 'idleMs': null },
    });
  });

  void it('preserves caller-supplied reservoir-mode concurrency and idleMs', () => {
    const policy = ScatterNodeDefaults.executionPolicy({
      ...BASE,
      'execution': { 'mode': 'reservoir', 'concurrency': 3, 'reservoir': { 'keyField': 'k', 'capacity': 5, 'idleMs': 100 } },
    });
    assert.deepEqual(policy, {
      'mode': 'reservoir',
      'concurrency': 3,
      'reservoir': { 'keyField': 'k', 'capacity': 5, 'idleMs': 100 },
    });
  });
});

// ─── mode: 'item' — execution.concurrency caps peak in-flight clone bodies ──

class ItemsState extends NodeStateBase {
  items: number[] = [];

  protected override snapshotData(): JsonObjectType {
    return { 'items': [...this.items] };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const raw = snap['items'];
    if (Array.isArray(raw)) this.items = raw.filter((x): x is number => typeof x === 'number');
  }
}

class ItemModeDag {
  private constructor() {}

  static of(name: string, concurrency: number): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoints': { 'main': 'fan' },
      'nodes': [
        {
          '@id':       `urn:noocodex:dag:${name}/node/fan`,
          '@type':     'ScatterNode',
          'name':      'fan',
          'body':      { 'node': 'worker' },
          'source':    'items',
          'itemKey':   'item',
          'execution': { 'mode': 'item', 'concurrency': concurrency },
          'gather':    { 'strategy': 'discard' },
          'outputs': {
            'all-success': 'end',
            'partial':     'end',
            'all-error':   'end',
            'empty':       'end',
          },
        },
        { '@id': `urn:noocodex:dag:${name}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
  }
}

void describe('Scatter execution policy — mode: item caps concurrently in-flight clones', () => {
  void it('peak concurrently executing clone bodies never exceeds execution.concurrency', async () => {
    const dispatcher = new Dagonizer<ItemsState>();
    let inFlight = 0;
    let peak = 0;

    dispatcher.registerNode(TestNode.make<ItemsState>('worker', ['success'], async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight--;
      return 'success';
    }));
    dispatcher.registerDAG(ItemModeDag.of('item-mode-cap', 3));

    const state = new ItemsState();
    state.items = [1, 2, 3, 4, 5, 6, 7, 8];
    await dispatcher.execute('item-mode-cap', state);

    assert.ok(peak <= 3, `peak in-flight clones was ${peak}, expected <= 3`);
    assert.ok(peak > 1, `peak in-flight clones was ${peak}, expected concurrency to actually parallelize (> 1)`);
  });
});

// ─── mode: 'reservoir' — execution.concurrency caps peak in-flight batches ──

class BatchState extends NodeStateBase {
  events: { key: string; value: number }[] = [];

  protected override snapshotData(): JsonObjectType {
    return { 'events': this.events.map((e) => ({ ...e })) };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const raw = snap['events'];
    if (Array.isArray(raw)) {
      this.events = raw.filter(
        (x): x is { key: string; value: number } =>
          typeof x === 'object' && x !== null && !Array.isArray(x) &&
          typeof x['key'] === 'string' && typeof x['value'] === 'number',
      );
    }
  }
}

class ReservoirModeDag {
  private constructor() {}

  static of(name: string, concurrency: number): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoints': { 'main': 'fan' },
      'nodes': [
        {
          '@id':       `urn:noocodex:dag:${name}/node/fan`,
          '@type':     'ScatterNode',
          'name':      'fan',
          'body':      { 'node': 'batch-worker' },
          'source':    'events',
          'itemKey':   'item',
          'execution': {
            'mode':       'reservoir',
            'concurrency': concurrency,
            // capacity: 1 → every item is its own batch, so 6 distinct keys
            // release 6 concurrently-dispatchable batches, letting the
            // concurrency cap actually bind.
            'reservoir': { 'keyField': 'key', 'capacity': 1 },
          },
          'gather':    { 'strategy': 'discard' },
          'outputs': {
            'all-success': 'end',
            'partial':     'end',
            'all-error':   'end',
            'empty':       'end',
          },
        },
        { '@id': `urn:noocodex:dag:${name}/node/end`, '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
  }
}

void describe('Scatter execution policy — mode: reservoir caps concurrently in-flight batches', () => {
  void it('peak concurrently executing batch dispatches never exceeds execution.concurrency (concurrency is NOT silently ignored under reservoir mode)', async () => {
    const dispatcher = new Dagonizer<BatchState>();
    let inFlight = 0;
    let peak = 0;

    dispatcher.registerNode(TestNode.make<BatchState>('batch-worker', ['success'], async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => setImmediate(resolve));
      inFlight--;
      return 'success';
    }));
    dispatcher.registerDAG(ReservoirModeDag.of('reservoir-mode-cap', 2));

    const state = new BatchState();
    // 6 distinct keys, capacity 1 → 6 independently-releasable batches.
    state.events = Array.from({ 'length': 6 }, (_, i) => ({ 'key': `k${i}`, 'value': i }));
    await dispatcher.execute('reservoir-mode-cap', state);

    assert.ok(peak <= 2, `peak in-flight batches was ${peak}, expected <= 2`);
    assert.ok(peak > 1, `peak in-flight batches was ${peak}, expected concurrency to actually parallelize (> 1)`);
  });
});
