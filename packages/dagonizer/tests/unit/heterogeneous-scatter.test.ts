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
import { Dagonizer } from '../../src/Dagonizer.js';
import type { GatherConfigType } from '../../src/entities/dag/GatherConfig.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { NodeStateInterface } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

const HETERO_SCATTER_DAG_IRI = 'urn:noocodec:dag:hetero-scatter';
const HETERO_SCATTER_FAN_OUT_IRI = 'urn:noocodec:dag:hetero-scatter/node/fan-out';
const HETERO_SCATTER_JOIN_IRI = 'urn:noocodec:dag:hetero-scatter/node/join';
const HETERO_SCATTER_END_IRI = 'urn:noocodec:dag:hetero-scatter/node/end';
const HETERO_ALL_EMPTY_DAG_IRI = 'urn:noocodec:dag:hetero-all-empty';
const HETERO_ALL_EMPTY_FAN_OUT_IRI = 'urn:noocodec:dag:hetero-all-empty/node/fan-out';
const HETERO_ALL_EMPTY_OK_IRI = 'urn:noocodec:dag:hetero-all-empty/node/ok';
const HETERO_ALL_EMPTY_FAIL_IRI = 'urn:noocodec:dag:hetero-all-empty/node/fail';
const HETERO_DISPATCH_NODE_IRI = 'urn:noocodec:node:dispatch';

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


}

// ── dispatch node ─────────────────────────────────────────────────────────────
// Reads currentItem (the provider descriptor) and produces a per-provider
// result. Three providers succeed, one returns 'empty'.

const dispatchNode = TestNode.make<HeterogeneousState>(
  HETERO_DISPATCH_NODE_IRI,
  ['success', 'empty'],
  (state) => {
    const provider = state.getter.string('currentItem', 'unknown');
    const dispatch: Record<string, () => string> = {
      'alpha': () => { state.providerResult = 'result-from-alpha'; return 'success'; },
      'beta':  () => { state.providerResult = 'result-from-beta';  return 'success'; },
      'gamma': () => { state.providerResult = 'result-from-gamma'; return 'success'; },
      'delta': () => { state.failMessages = [...state.failMessages, 'delta: no results']; return 'empty'; },
    };
    return (dispatch[provider] ?? (() => 'empty'))();
  },
);

// ── custom gather strategy ───────────────────────────────────────────────────
// Flat-merges each clone's `providerResult` into the parent `results` array
// and merges `errors` from clones that failed.

class FlatMergeGather extends GatherStrategy {
  readonly name = 'flat-merge-test';
  readonly '@id' = 'urn:noocodec:node:flat-merge-test';

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record: GatherRecordType = item.state;
      const rawResults = accessor.get(state, 'results');
      const existingResults: string[] = Array.isArray(rawResults) ? rawResults.filter((x): x is string => typeof x === 'string') : [];
      const rawFails = accessor.get(state, 'failMessages');
      const existingFails: string[] = Array.isArray(rawFails) ? rawFails.filter((x): x is string => typeof x === 'string') : [];

      const rawResult = accessor.get(record.cloneState, 'providerResult');
      const result: string = typeof rawResult === 'string' ? rawResult : '';
      const rawCloneFails = accessor.get(record.cloneState, 'failMessages');
      const cloneFails: string[] = Array.isArray(rawCloneFails) ? rawCloneFails.filter((x): x is string => typeof x === 'string') : [];

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

    const dag = new DAGBuilder(HETERO_SCATTER_DAG_IRI, '1.0', { 'name': 'hetero-scatter' })
      .scatter(HETERO_SCATTER_FAN_OUT_IRI, 'providers', dispatchNode, {
        'success':     HETERO_SCATTER_JOIN_IRI,
        'error':       HETERO_SCATTER_JOIN_IRI,
        'empty':       HETERO_SCATTER_JOIN_IRI,
        'all-success': HETERO_SCATTER_JOIN_IRI,
        'all-error':   HETERO_SCATTER_JOIN_IRI,
        'partial':     HETERO_SCATTER_JOIN_IRI,
      }, {
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'reducer': 'any-success',
      })
      .gather(HETERO_SCATTER_JOIN_IRI, { [HETERO_SCATTER_FAN_OUT_IRI]: {} }, { 'strategy': 'flat-merge-test' }, {
        'success': HETERO_SCATTER_END_IRI,
        'error': HETERO_SCATTER_END_IRI,
        'empty': HETERO_SCATTER_END_IRI,
      }, { 'name': 'join' })
      .terminal(HETERO_SCATTER_END_IRI, { 'name': 'end', 'outcome': 'completed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new HeterogeneousState();
    state.providers = ['alpha', 'beta', 'gamma', 'delta'];

    const result = await dispatcher.execute(HETERO_SCATTER_DAG_IRI, state);

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

    const emptyDispatch = TestNode.make<HeterogeneousState>('urn:noocodec:node:empty-dispatch', ['success', 'empty'], () => 'empty');
    dispatcher.registerNode(emptyDispatch);

    const dag = new DAGBuilder(HETERO_ALL_EMPTY_DAG_IRI, '1.0', { 'name': 'hetero-all-empty' })
      .scatter(HETERO_ALL_EMPTY_FAN_OUT_IRI, 'providers', emptyDispatch, {
        'success': HETERO_ALL_EMPTY_OK_IRI,
        'error':   HETERO_ALL_EMPTY_FAIL_IRI,
        'empty':   HETERO_ALL_EMPTY_FAIL_IRI,
      }, {
        'execution': { 'mode': 'item', 'concurrency': 4 },
        'reducer': 'any-success',
        'name': 'fan-out',
      })
      .terminal(HETERO_ALL_EMPTY_OK_IRI, { 'name': 'ok', 'outcome': 'completed' })
      .terminal(HETERO_ALL_EMPTY_FAIL_IRI, { 'name': 'fail', 'outcome': 'failed' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new HeterogeneousState();
    state.providers = ['alpha', 'beta', 'gamma', 'delta'];

    const result = await dispatcher.execute(HETERO_ALL_EMPTY_DAG_IRI, state);

    // any-success: all returned empty → 'error' route → fail terminal.
    assert.equal(result.state.lifecycle.variant, 'failed', 'flow failed when all providers return empty');
  });
});
