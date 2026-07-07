import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { StateAccessorInterface } from '../../src/contracts/StateAccessorInterface.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import type { GatherRecordType } from '../../src/core/GatherStrategies.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonObjectType, JsonValueType } from '../../src/entities/json.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const STRATEGY_NAME = 'test-tracking-gather';

/** Records the call order of `initial`, `reduce`, and `finalize` hooks. */
class TrackingGatherStrategy extends GatherStrategy {
  override readonly name: string;
  readonly markers: string[];

  constructor(name: string, markers: string[]) {
    super();
    this.name = name;
    this.markers = markers;
  }

  override initial(
    _config: GatherConfigType,
    _state: NodeStateInterface,
    _accessor: StateAccessorInterface,
  ): void {
    this.markers.push('initial');
  }

  reduce(
    _config: GatherConfigType,
    _batch: Batch<GatherRecordType>,
    _state: NodeStateInterface,
    _accessor: StateAccessorInterface,
  ): void {
    this.markers.push('reduce');
  }
}

/** Static factory for `TrackingGatherStrategy` instances. */
class TrackingGather {
  private constructor() { /* static class */ }

  static of(name: string, markers: string[]): TrackingGatherStrategy {
    return new TrackingGatherStrategy(name, markers);
  }
}

/** State used across gather-initial tests. */
class GatherInitialState extends NodeStateBase {
  items: number[] = [];
  results: JsonValueType[] = [];

  protected override snapshotData(): JsonObjectType {
    return {
      'items':   [...this.items],
      'results': [...this.results],
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const items = snap['items'];
    if (Array.isArray(items)) {
      this.items = items.filter((x): x is number => typeof x === 'number');
    }
    const results = snap['results'];
    if (Array.isArray(results)) {
      this.results = [...results];
    }
  }
}

/** Static DAG factory for gather-initial tests. */
class TestGatherInitialDag {
  private constructor() { /* static class */ }

  static of(dagName: string, strategyName: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${dagName}`,
      '@type':    'DAG',
      'name':     dagName,
      'version':  '1',
      'entrypoints': { 'main': 'fan' },
      'nodes': [
        {
          '@id':   `urn:noocodex:dag:${dagName}/node/fan`,
          '@type': 'ScatterNode',
          'name':  'fan',
          'body':  { 'node': 'worker' },
          'source':  'items',
          'itemKey': 'item',
          'execution': { 'mode': 'item', 'concurrency': 1 },
          'gather': { 'strategy': strategyName },
          'outputs': {
            'all-success': 'end',
            'partial':     'end',
            'all-error':   'end',
            'empty':       'end',
          },
        },
        {
          '@id':    `urn:noocodex:dag:${dagName}/node/end`,
          '@type':  'TerminalNode',
          'name':   'end',
          'outcome': 'completed',
        },
      ],
    };
  }
}

void describe('GatherStrategy.initial() lifecycle hook', () => {
  afterEach(() => {
    GatherStrategies.unregister(STRATEGY_NAME);
  });

  void it('calls initial() exactly once before the first reduce on a fresh scatter', async () => {
    const markers: string[] = [];
    const strategy = TrackingGather.of(STRATEGY_NAME, markers);
    GatherStrategies.register(strategy);

    const dispatcher = new Dagonizer<GatherInitialState>();
    dispatcher.registerNode(TestNode.make<GatherInitialState>('worker', ['success']));
    dispatcher.registerDAG(TestGatherInitialDag.of('gather-initial-fresh', STRATEGY_NAME));

    const state = new GatherInitialState();
    state.items = [1, 2, 3];

    await dispatcher.execute('gather-initial-fresh', state);

    // initial() must be called exactly once.
    const initialCount = markers.filter((m) => m === 'initial').length;
    assert.equal(initialCount, 1, `expected exactly 1 'initial' call, got ${initialCount}`);

    // First marker must be 'initial'.
    assert.equal(markers[0], 'initial', `expected first marker to be 'initial', got '${markers[0]}'`);

    // All 'initial' entries must precede all 'reduce' entries.
    const lastInitialIdx = markers.lastIndexOf('initial');
    const firstReduceIdx = markers.indexOf('reduce');
    assert.ok(
      firstReduceIdx !== -1,
      'expected at least one reduce call',
    );
    assert.ok(
      lastInitialIdx < firstReduceIdx,
      `expected all 'initial' entries before first 'reduce'; lastInitial=${lastInitialIdx} firstReduce=${firstReduceIdx}`,
    );
  });

  void it('does NOT call initial() on resume (stored checkpoint present)', async () => {
    const markers: string[] = [];
    const strategy = TrackingGather.of(STRATEGY_NAME, markers);
    GatherStrategies.register(strategy);

    const dispatcher = new Dagonizer<GatherInitialState>();
    dispatcher.registerNode(TestNode.make<GatherInitialState>('worker', ['success']));
    dispatcher.registerDAG(TestGatherInitialDag.of('gather-initial-resume', STRATEGY_NAME));

    // Pre-seed a bounded checkpoint: items 0 and 1 "already done".
    const state = new GatherInitialState();
    state.items = [1, 2, 3, 4, 5];
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      'fan': {
        'mode': 'bounded' as const,
        'placementName': 'fan',
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
      },
    });

    await dispatcher.resume('gather-initial-resume', state, 'fan');

    // initial() must NOT be called on resume.
    const initialCount = markers.filter((m) => m === 'initial').length;
    assert.equal(initialCount, 0, `expected 0 'initial' calls on resume, got ${initialCount}`);

    // Only the 3 remaining items (indices 2, 3, 4) should have triggered reduce.
    const reduceCount = markers.filter((m) => m === 'reduce').length;
    assert.equal(reduceCount, 3, `expected 3 'reduce' calls on resume, got ${reduceCount}`);
  });
});
