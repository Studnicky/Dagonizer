/**
 * scatter-throttle: proves `ScatterNode.throttle` gates item dispatch through
 * a real `@studnicky/throttle` `Throttle` instance, independent of the
 * `concurrency` semaphore.
 *
 * `throttle.concurrencyLimit` is a SECOND concurrency window wrapping
 * `driver.executeItem`. With `concurrency` wide enough to admit every item at
 * once, a tight `throttle.concurrencyLimit` (1) still forces items to run one
 * at a time. The test observes in-flight item bodies directly instead of
 * relying on wall-clock elapsed time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const ITEM_DELAY_MS = 25;
const THROTTLE_OFF_DAG_IRI = 'urn:noocodec:dag:throttle-off';
const THROTTLE_ON_DAG_IRI = 'urn:noocodec:dag:throttle-on';
const THROTTLE_ABSENT_DAG_IRI = 'urn:noocodec:dag:throttle-absent';

const placementIri = (dagIri: string, placementName: string): string => `${dagIri}/node/${placementName}`;

interface ConcurrencyProbe {
  active: number;
  maxActive: number;
  starts: number;
}

class ItemsState extends NodeStateBase {
  items: number[] = [];
  // Folded from each clone's item via the scatter's `append` gather — direct
  // field mutation on the per-item clone (e.g. a `completed` counter) never
  // reaches the parent state; only gather-mediated fields do.
  itemResults: number[] = [];


}

function createProbe(): ConcurrencyProbe {
  return { 'active': 0, 'maxActive': 0, 'starts': 0 };
}

// Each item body sleeps a fixed delay so overlapping executions remain
// observable through the in-flight counter. Completion is folded into parent
// state via the scatter's `append` gather (see `ThrottleTestDag.of`).
function delayedNode(probe: ConcurrencyProbe) {
  return TestNode.make<ItemsState>('urn:noocodec:node:delayed', ['done'], async () => {
    probe.active += 1;
    probe.starts += 1;
    probe.maxActive = Math.max(probe.maxActive, probe.active);
    try {
      await new Promise<void>((resolve) => { setTimeout(resolve, ITEM_DELAY_MS); });
      return 'done';
    } finally {
      probe.active -= 1;
    }
  });
}


class ThrottleTestDag {
  private constructor() {}

  /** Scatter with `concurrency` wide enough to admit every item in one wave,
   * and an optional `throttle` further gating dispatch. */
  static of(dagIri: string, name: string, itemCount: number, throttle: { concurrencyLimit: number } | null): DAGType {
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
          '@type':       'ScatterNode',
          'name':        'fan',
          'body':        { 'node': 'urn:noocodec:node:delayed' },
          'source':      'items',
          'itemKey':     'item',
          'execution': {
            'mode': 'item',
            'concurrency': itemCount,
            ...(throttle !== null ? { 'throttle': throttle } : {}),
          },
          'outputs': {
            'all-success': placementIri(dagIri, 'join'),
            'partial': placementIri(dagIri, 'join'),
            'all-error': placementIri(dagIri, 'join'),
            'empty': placementIri(dagIri, 'end'),
          },
        },
        {
          '@id': placementIri(dagIri, 'join'),
          '@type': 'GatherNode',
          'name': 'join',
          'sources': { [placementIri(dagIri, 'fan')]: {} },
          'gather': { 'strategy': 'append', 'target': 'itemResults' },
          'outputs': {
            'success': placementIri(dagIri, 'end'),
            'error': placementIri(dagIri, 'end'),
            'empty': placementIri(dagIri, 'end'),
          },
        },
        {
          '@id': placementIri(dagIri, 'end'),
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
  }
}

void describe('Scatter: throttle option gates item dispatch through @studnicky/throttle', () => {
  void it('a tight throttle.concurrencyLimit serializes item body execution independently of scatter concurrency', async () => {
    const N = 5;

    const unthrottledProbe = createProbe();
    const unthrottledDispatcher = new Dagonizer<ItemsState>();
    unthrottledDispatcher.registerNode(delayedNode(unthrottledProbe));
    unthrottledDispatcher.registerDAG(ThrottleTestDag.of(THROTTLE_OFF_DAG_IRI, 'throttle-off', N, null));

    const unthrottledState = new ItemsState();
    unthrottledState.items = Array.from({ 'length': N }, (_, i) => i);

    const unthrottledResult = await unthrottledDispatcher.execute(THROTTLE_OFF_DAG_IRI, unthrottledState);

    assert.equal(unthrottledResult.state.itemResults.length, N, 'all items must complete without throttle');

    const throttledProbe = createProbe();
    const throttledDispatcher = new Dagonizer<ItemsState>();
    throttledDispatcher.registerNode(delayedNode(throttledProbe));
    throttledDispatcher.registerDAG(ThrottleTestDag.of(THROTTLE_ON_DAG_IRI, 'throttle-on', N, { 'concurrencyLimit': 1 }));

    const throttledState = new ItemsState();
    throttledState.items = Array.from({ 'length': N }, (_, i) => i);

    const throttledResult = await throttledDispatcher.execute(THROTTLE_ON_DAG_IRI, throttledState);

    assert.equal(throttledResult.state.itemResults.length, N, 'all items must complete under throttle');
    assert.equal(unthrottledProbe.starts, N, 'unthrottled run must start every item body');
    assert.equal(throttledProbe.starts, N, 'throttled run must start every item body');
    assert.ok(
      unthrottledProbe.maxActive > 1,
      `unthrottled run should execute multiple item bodies concurrently; max active was ${unthrottledProbe.maxActive}`,
    );
    assert.equal(
      throttledProbe.maxActive,
      1,
      `throttle.concurrencyLimit=1 should serialize item body execution; max active was ${throttledProbe.maxActive}`,
    );
  });

  void it('throttle: null (default, throttle field absent) behaves identically to the pre-throttle path', async () => {
    const N = 4;

    const dispatcher = new Dagonizer<ItemsState>();
    dispatcher.registerNode(delayedNode(createProbe()));
    dispatcher.registerDAG(ThrottleTestDag.of(THROTTLE_ABSENT_DAG_IRI, 'throttle-absent', N, null));

    const state = new ItemsState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const result = await dispatcher.execute(THROTTLE_ABSENT_DAG_IRI, state);

    assert.equal(result.cursor, null, 'flow must complete cleanly');
    assert.equal(result.state.itemResults.length, N, `all N=${N} items must complete`);
  });
});
