/**
 * heterogeneous-scatter: proves a scatter over a descriptor source with a
 * dispatching body + custom gather fans out, runs per-descriptor work, and
 * collects results — the structural/heterogeneous case expressed as scatter.
 *
 * The test mirrors the Archivist's scout-dispatch pattern:
 *   source = state.providers (a fixed descriptor array)
 *   body   = scoutDispatch (reads currentItem, branches to matching logic)
 *   gather = flat-merge custom gather strategy
 *   concurrency = 4 (all providers in-flight simultaneously)
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { StateAccessorInterface } from '../../src/contracts/StateAccessorInterface.js';
import type { GatherRecordType } from '../../src/core/GatherStrategies.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import type { JsonObjectType } from '../../src/entities/json.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';

// ── state ────────────────────────────────────────────────────────────────────

/**
 * Domain state carrying a provider descriptor source, per-provider results
 * (accumulated by the dispatching body), and an aggregated flat array.
 */
class HeterogeneousState extends NodeStateBase {
  /** Scatter source: fixed provider descriptor array. */
  providers: string[] = [];
  /** Each clone writes its result here; gather flat-merges into `results`. */
  providerResult: string = '';
  /** Flat-merged results from all provider clones (parent state). */
  results: string[] = [];
  /** Per-provider failure messages (parent state). Distinct from base `errors`. */
  failMessages: string[] = [];

  protected override snapshotData(): JsonObjectType {
    return {
      'providers':      [...this.providers],
      'providerResult': this.providerResult,
      'results':        [...this.results],
      'failMessages':   [...this.failMessages],
    };
  }

  protected override restoreData(snap: JsonObjectType): void {
    if (Array.isArray(snap['providers']))              this.providers     = snap['providers'] as string[];
    if (typeof snap['providerResult'] === 'string')    this.providerResult = snap['providerResult'];
    if (Array.isArray(snap['results']))                this.results        = snap['results'] as string[];
    if (Array.isArray(snap['failMessages']))           this.failMessages   = snap['failMessages'] as string[];
  }
}

// ── dispatch node ─────────────────────────────────────────────────────────────
// Reads currentItem (the provider descriptor) and produces a per-provider
// result. Three providers succeed, one returns 'empty'.

class DispatchNode extends ScalarNode<HeterogeneousState, 'success' | 'empty'> {
  readonly name = 'dispatch';
  readonly outputs = ['success', 'empty'] as const;
  protected async executeOne(state: HeterogeneousState): Promise<NodeOutputType<'success' | 'empty'>> {
    const provider = state.getMetadata<string>('currentItem') ?? 'unknown';
    switch (provider) {
      case 'alpha': {
        state.providerResult = 'result-from-alpha';
        return { 'errors': [], 'output': 'success' };
      }
      case 'beta': {
        state.providerResult = 'result-from-beta';
        return { 'errors': [], 'output': 'success' };
      }
      case 'gamma': {
        state.providerResult = 'result-from-gamma';
        return { 'errors': [], 'output': 'success' };
      }
      case 'delta': {
        // delta returns empty — no results from this provider.
        state.failMessages = [...state.failMessages, 'delta: no results'];
        return { 'errors': [], 'output': 'empty' };
      }
      default: {
        return { 'errors': [], 'output': 'empty' };
      }
    }
  }
}

const dispatchNode = new DispatchNode();

// ── custom gather strategy ───────────────────────────────────────────────────
// Flat-merges each clone's `providerResult` into the parent `results` array
// and merges `errors` from clones that failed.

class FlatMergeGather extends GatherStrategy {
  readonly name = 'flat-merge-test';

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record: GatherRecordType = item.state;
      const existingResults = accessor.get<string[]>(state, 'results')      ?? [];
      const existingFails   = accessor.get<string[]>(state, 'failMessages') ?? [];

      const result = accessor.get<string>(record.cloneState, 'providerResult') ?? '';
      const cloneFails = accessor.get<string[]>(record.cloneState, 'failMessages') ?? [];

      if (result.length > 0) {
        accessor.set(state, 'results', [...existingResults, result]);
      }
      if (cloneFails.length > 0) {
        accessor.set(state, 'failMessages', [...existingFails, ...cloneFails]);
      }
    }
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

void describe('heterogeneous scatter (descriptor source + dispatching body)', () => {
  beforeEach(() => { GatherStrategies.register(new FlatMergeGather()); });
  afterEach(() => { GatherStrategies.unregister('flat-merge-test'); });
  void it('fans out to all four providers concurrently and collects per-provider results', async () => {
    const dispatcher = new Dagonizer<HeterogeneousState>();
    dispatcher.registerNode(dispatchNode);

    const dag = new DAGBuilder('hetero-scatter', '1.0')
      .scatter('fan-out', 'providers', dispatchNode, {
        'success':     'end',
        'error':       'end',
        'empty':       'end',
        'all-success': 'end',
        'all-error':   'end',
        'partial':     'end',
      }, {
        'concurrency': 4,
        'gather':  { 'strategy': 'flat-merge-test' },
        'reducer': 'any-success',
      })
      .terminal('end', { 'outcome': 'completed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new HeterogeneousState();
    state.providers = ['alpha', 'beta', 'gamma', 'delta'];

    const result = await dispatcher.execute('hetero-scatter', state);

    // Three providers succeeded, one returned empty.
    assert.equal(result.state.results.length, 3, 'three successful provider results collected');
    // Results are collected in source-index order (alpha=0, beta=1, gamma=2).
    assert.ok(result.state.results.includes('result-from-alpha'), 'alpha result present');
    assert.ok(result.state.results.includes('result-from-beta'),  'beta result present');
    assert.ok(result.state.results.includes('result-from-gamma'), 'gamma result present');

    // Failure message from delta is merged.
    assert.equal(result.state.failMessages.length, 1, 'one failure message accumulated from delta');
    assert.ok(result.state.failMessages[0]?.startsWith('delta:'), 'delta failure text present');

    // any-success reducer: at least one clone succeeded → 'success' → 'end' terminal.
    assert.equal(result.cursor, null, 'flow completed cleanly');
  });

  void it('routes error when all providers return empty', async () => {
    const dispatcher = new Dagonizer<HeterogeneousState>();

    class EmptyDispatchNode extends ScalarNode<HeterogeneousState, 'success' | 'empty'> {
      readonly name = 'empty-dispatch';
      readonly outputs = ['success', 'empty'] as const;
      protected async executeOne(_state: HeterogeneousState): Promise<NodeOutputType<'success' | 'empty'>> {
        return { 'errors': [], 'output': 'empty' };
      }
    }
    const emptyDispatch = new EmptyDispatchNode();
    dispatcher.registerNode(emptyDispatch);

    const dag = new DAGBuilder('hetero-all-empty', '1.0')
      .scatter('fan-out', 'providers', emptyDispatch, {
        'success': 'ok',
        'error':   'fail',
        'empty':   'fail',
      }, {
        'concurrency': 4,
        'gather':  { 'strategy': 'discard' },
        'reducer': 'any-success',
      })
      .terminal('ok',   { 'outcome': 'completed' })
      .terminal('fail', { 'outcome': 'failed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new HeterogeneousState();
    state.providers = ['alpha', 'beta', 'gamma', 'delta'];

    const result = await dispatcher.execute('hetero-all-empty', state);

    // any-success: all returned empty → 'error' route → fail terminal.
    assert.equal(result.state.lifecycle.variant, 'failed', 'flow failed when all providers return empty');
  });
});
