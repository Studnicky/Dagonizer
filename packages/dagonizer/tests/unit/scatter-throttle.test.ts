/**
 * scatter-throttle: proves `ScatterNode.throttle` gates item dispatch through
 * a real `@studnicky/throttle` `Throttle` instance, independent of the
 * `concurrency` semaphore.
 *
 * `throttle.concurrencyLimit` is a SECOND concurrency window wrapping
 * `driver.executeItem`. With `concurrency` wide enough to admit every item at
 * once, a tight `throttle.concurrencyLimit` (1) still forces items to run one
 * at a time — a strictly longer wall-clock time than the same DAG with no
 * throttle set, which runs every item in one wave.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const ITEM_DELAY_MS = 25;

class ItemsState extends NodeStateBase {
  items: number[] = [];
  // Folded from each clone's item via the scatter's `append` gather — direct
  // field mutation on the per-item clone (e.g. a `completed` counter) never
  // reaches the parent state; only gather-mediated fields do.
  itemResults: number[] = [];

  protected override snapshotData(): JsonObjectType {
    return { 'items': [...this.items], 'itemResults': [...this.itemResults] };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const rawItems = snap['items'];
    if (Array.isArray(rawItems)) this.items = rawItems.filter((x): x is number => typeof x === 'number');
    const rawResults = snap['itemResults'];
    if (Array.isArray(rawResults)) this.itemResults = rawResults.filter((x): x is number => typeof x === 'number');
  }
}

// Each item body sleeps a fixed delay — the delay is what makes serialization
// vs. parallelism observable in wall time. Completion is folded into parent
// state via the scatter's `append` gather (see `ThrottleTestDag.of`).
const delayedNode = TestNode.make<ItemsState>('delayed', ['done'], async () => {
  await new Promise<void>((resolve) => { setTimeout(resolve, ITEM_DELAY_MS); });
  return 'done';
});

class ThrottleTestDag {
  private constructor() {}

  /** Scatter with `concurrency` wide enough to admit every item in one wave,
   * and an optional `throttle` further gating dispatch. */
  static of(name: string, itemCount: number, throttle: { concurrencyLimit: number } | null): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':         `urn:noocodex:dag:${name}/node/fan`,
          '@type':       'ScatterNode',
          'name':        'fan',
          'body':        { 'node': 'delayed' },
          'source':      'items',
          'itemKey':     'item',
          'execution': {
            'mode': 'item',
            'concurrency': itemCount,
            ...(throttle !== null ? { 'throttle': throttle } : {}),
          },
          'gather':      { 'strategy': 'append', 'target': 'itemResults' },
          'outputs': {
            'all-success': 'end',
            'partial':     'end',
            'all-error':   'end',
            'empty':       'end',
          },
        },
        {
          '@id':     `urn:noocodex:dag:${name}/node/end`,
          '@type':   'TerminalNode',
          'name':    'end',
          'outcome': 'completed',
        },
      ],
    };
  }
}

void describe('Scatter: throttle option gates item dispatch through @studnicky/throttle', () => {
  void it('a tight throttle.concurrencyLimit forces items to serialize, taking measurably longer than the same DAG with no throttle', async () => {
    const N = 5;

    const unthrottledDispatcher = new Dagonizer<ItemsState>();
    unthrottledDispatcher.registerNode(delayedNode);
    unthrottledDispatcher.registerDAG(ThrottleTestDag.of('throttle-off', N, null));

    const unthrottledState = new ItemsState();
    unthrottledState.items = Array.from({ 'length': N }, (_, i) => i);

    const unthrottledStart = Date.now();
    const unthrottledResult = await unthrottledDispatcher.execute('throttle-off', unthrottledState);
    const unthrottledElapsed = Date.now() - unthrottledStart;

    assert.equal(unthrottledResult.state.itemResults.length, N, 'all items must complete without throttle');

    const throttledDispatcher = new Dagonizer<ItemsState>();
    throttledDispatcher.registerNode(delayedNode);
    throttledDispatcher.registerDAG(ThrottleTestDag.of('throttle-on', N, { 'concurrencyLimit': 1 }));

    const throttledState = new ItemsState();
    throttledState.items = Array.from({ 'length': N }, (_, i) => i);

    const throttledStart = Date.now();
    const throttledResult = await throttledDispatcher.execute('throttle-on', throttledState);
    const throttledElapsed = Date.now() - throttledStart;

    assert.equal(throttledResult.state.itemResults.length, N, 'all items must complete under throttle');

    // Unthrottled: concurrency=N admits every item in one wave — elapsed time
    // is close to one ITEM_DELAY_MS, not N * ITEM_DELAY_MS.
    // Throttled (concurrencyLimit=1): items serialize through the throttle
    // despite concurrency=N — elapsed time is close to N * ITEM_DELAY_MS.
    const serialFloor = (N - 1) * ITEM_DELAY_MS; // allow one item's slack
    assert.ok(
      throttledElapsed >= serialFloor,
      `throttled run must take at least ${serialFloor}ms (serialized through throttle.concurrencyLimit=1); took ${throttledElapsed}ms`,
    );
    assert.ok(
      throttledElapsed > unthrottledElapsed,
      `throttled run (${throttledElapsed}ms) must take measurably longer than the unthrottled run (${unthrottledElapsed}ms)`,
    );
  });

  void it('throttle: null (default, throttle field absent) behaves identically to the pre-throttle path', async () => {
    const N = 4;

    const dispatcher = new Dagonizer<ItemsState>();
    dispatcher.registerNode(delayedNode);
    dispatcher.registerDAG(ThrottleTestDag.of('throttle-absent', N, null));

    const state = new ItemsState();
    state.items = Array.from({ 'length': N }, (_, i) => i);

    const result = await dispatcher.execute('throttle-absent', state);

    assert.equal(result.cursor, null, 'flow must complete cleanly');
    assert.equal(result.state.itemResults.length, N, `all N=${N} items must complete`);
  });
});
