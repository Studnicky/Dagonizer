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
import type { TransientNodeStateSelectionType } from '../../src/entities/executor/TransientNodeState.js';
import type { DAGType } from '../../src/entities/index.js';
import type { JsonValueType } from '../../src/entities/json.js';
import { GatherBuffers } from '../../src/execution/GatherBuffers.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const STRATEGY_NAME = 'test-tracking-gather';
const placementIri = (dagIri: string, placementName: string): string => `${dagIri}/node/${placementName}`;

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


}

/** Static DAG factory for gather-initial tests. */
class TestGatherInitialDag {
  private constructor() { /* static class */ }

  static of(dagName: string, strategyName: string): DAGType {
    const dagIri = `urn:noocodec:dag:${dagName}`;
    const fanIri = placementIri(dagIri, 'fan');
    const joinIri = placementIri(dagIri, 'join');
    const endIri = placementIri(dagIri, 'end');
    return {
      '@context': DAG_CONTEXT,
      '@id': dagIri,
      '@type':    'DAG',
      'name':     dagName,
      'version':  '1',
      'entrypoints': { 'main': fanIri },
      'nodes': [
        {
          '@id': fanIri,
          '@type': 'ScatterNode',
          'name':  'fan',
          'body':  { 'node': 'urn:noocodec:node:worker' },
          'source':  'items',
          'itemKey': 'item',
          'configuration': { 'execution': { 'batching': { 'mode': 'item', 'concurrency': 1 } } },
          'outputs': {
            'all-success': joinIri,
            'partial': joinIri,
            'all-error': joinIri,
            'empty': endIri,
          },
        },
        {
          '@id': joinIri,
          '@type': 'GatherNode',
          'name': 'join',
          'sources': { [fanIri]: {} },
          'gather': { 'strategy': strategyName },
          'outputs': {
            'success': endIri,
            'error': endIri,
            'empty': endIri,
          },
        },
        {
          '@id': endIri,
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
    dispatcher.registerNode(TestNode.make<GatherInitialState>('urn:noocodec:node:worker', ['success']));
    dispatcher.registerDAG(TestGatherInitialDag.of('gather-initial-fresh', STRATEGY_NAME));

    const state = new GatherInitialState();
    state.items = [1, 2, 3];

    await dispatcher.execute('urn:noocodec:dag:gather-initial-fresh', state);

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
    dispatcher.registerNode(TestNode.make<GatherInitialState>('urn:noocodec:node:worker', ['success']));
    dispatcher.registerDAG(TestGatherInitialDag.of('gather-initial-resume', STRATEGY_NAME));

    // Pre-seed a bounded checkpoint: items 0 and 1 "already done".
    const state = new GatherInitialState();
    state.items = [1, 2, 3, 4, 5];
    const fanIri = placementIri('urn:noocodec:dag:gather-initial-resume', 'fan');
    state.setMetadata(SCATTER_PROGRESS_KEY, {
      [fanIri]: {
        'mode': 'bounded' as const,
        'placementName': fanIri,
        'inbox': [],
        'watermark': 2,
        'aheadAcked': [],
        'outcomeTally': { 'success': 2 },
      },
    });

    await dispatcher.resume('urn:noocodec:dag:gather-initial-resume', state, fanIri);

    // initial() must NOT be called on resume.
    const initialCount = markers.filter((m) => m === 'initial').length;
    assert.equal(initialCount, 0, `expected 0 'initial' calls on resume, got ${initialCount}`);

    // Only the 3 remaining items (indices 2, 3, 4) should have triggered reduce.
    const reduceCount = markers.filter((m) => m === 'reduce').length;
    assert.equal(reduceCount, 3, `expected 3 'reduce' calls on resume, got ${reduceCount}`);
  });
});

/** Gather strategy registered under a non-built-in name, declaring a narrow selection. */
class NarrowSelectionGatherStrategy extends GatherStrategy {
  override readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  reduce(): void { /* no-op: this suite exercises progress compaction only */ }

  override transientResultSelection(): TransientNodeStateSelectionType {
    return { 'mode': 'selection', 'domainPaths': ['resultValue'], 'metadataKeys': [] };
  }
}

/** Gather strategy registered under a non-built-in name, with no declared selection (defaults to full). */
class FullSelectionGatherStrategy extends GatherStrategy {
  override readonly name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  reduce(): void { /* no-op: this suite exercises progress compaction only */ }
}

/** Minimal state used as a scatter clone's `cloneState` for GatherBuffers compaction tests. */
class CompactionCloneState extends NodeStateBase {
  value = 0;
}

const NARROW_STRATEGY_NAME = 'test-narrow-selection-gather';
const FULL_STRATEGY_NAME = 'test-full-selection-gather';

void describe('GatherBuffers progress compaction via transientResultSelection()', () => {
  afterEach(() => {
    GatherStrategies.unregister(NARROW_STRATEGY_NAME);
    GatherStrategies.unregister(FULL_STRATEGY_NAME);
  });

  void it('compacts a custom-named strategy with a narrow transientResultSelection() and a result to `result`, dropping graphState', () => {
    GatherStrategies.register(new NarrowSelectionGatherStrategy(NARROW_STRATEGY_NAME));

    const gatherKey = 'urn:noocodec:dag:compaction-narrow/node/join/execution/0';
    const gather: GatherConfigType = { 'strategy': NARROW_STRATEGY_NAME };
    const record: GatherRecordType = {
      'source': 'urn:noocodec:dag:compaction-narrow/node/fan',
      'index': 0,
      'item': { 'n': 1 },
      'output': 'success',
      'terminalOutcome': 'completed',
      'result': { 'resultValue': 42 },
      'cloneState': new CompactionCloneState(),
    };

    const buffers = new GatherBuffers();
    buffers.add(gatherKey, record);
    const progress = buffers.toProgress(() => gather, () => undefined);

    const entries = progress.entries[gatherKey];
    assert.ok(entries !== undefined, 'expected a progress entry for the gather key');
    assert.equal(entries.length, 1);
    const progressRecord = entries[0];
    assert.ok(progressRecord !== undefined, 'expected a progress record');
    assert.deepEqual(progressRecord.result, { 'resultValue': 42 });
    assert.equal('graphState' in progressRecord, false, 'expected compaction to drop graphState');
  });

  void it('retains full graphState for a custom-named strategy with no declared selection (defaults to full) even when a result is present', () => {
    GatherStrategies.register(new FullSelectionGatherStrategy(FULL_STRATEGY_NAME));

    const gatherKey = 'urn:noocodec:dag:compaction-full/node/join/execution/0';
    const gather: GatherConfigType = { 'strategy': FULL_STRATEGY_NAME };
    const record: GatherRecordType = {
      'source': 'urn:noocodec:dag:compaction-full/node/fan',
      'index': 0,
      'item': { 'n': 1 },
      'output': 'success',
      'terminalOutcome': 'completed',
      'result': { 'resultValue': 42 },
      'cloneState': new CompactionCloneState(),
    };

    const buffers = new GatherBuffers();
    buffers.add(gatherKey, record);
    const progress = buffers.toProgress(() => gather, () => undefined);

    const entries = progress.entries[gatherKey];
    assert.ok(entries !== undefined, 'expected a progress entry for the gather key');
    assert.equal(entries.length, 1);
    const progressRecord = entries[0];
    assert.ok(progressRecord !== undefined, 'expected a progress record');
    assert.ok('graphState' in progressRecord, 'expected full-clone retention when no narrow selection is declared');
  });

  void it('retains full graphState when a strategy declares a narrow selection but produced no result (no data loss)', () => {
    GatherStrategies.register(new NarrowSelectionGatherStrategy(NARROW_STRATEGY_NAME));

    const gatherKey = 'urn:noocodec:dag:compaction-no-result/node/join/execution/0';
    const gather: GatherConfigType = { 'strategy': NARROW_STRATEGY_NAME };
    const record: GatherRecordType = {
      'source': 'urn:noocodec:dag:compaction-no-result/node/fan',
      'index': 0,
      'item': { 'n': 1 },
      'output': 'success',
      'terminalOutcome': 'completed',
      'result': undefined,
      'cloneState': new CompactionCloneState(),
    };

    const buffers = new GatherBuffers();
    buffers.add(gatherKey, record);
    const progress = buffers.toProgress(() => gather, () => undefined);

    const entries = progress.entries[gatherKey];
    assert.ok(entries !== undefined, 'expected a progress entry for the gather key');
    assert.equal(entries.length, 1);
    const progressRecord = entries[0];
    assert.ok(progressRecord !== undefined, 'expected a progress record');
    assert.ok('graphState' in progressRecord, 'expected full-clone retention when no result was produced');
  });
});
