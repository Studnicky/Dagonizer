/**
 * heterogeneous-scatter: proves a scatter over a descriptor source with a
 * dispatching body + custom gather fans out, runs per-descriptor work, and
 * collects results — the structural/heterogeneous case the old ParallelNode
 * covered, now expressed as scatter.
 *
 * The test mirrors the Archivist's scout-dispatch pattern:
 *   source = state.providers (a fixed descriptor array)
 *   body   = scoutDispatch (reads currentItem, branches to matching logic)
 *   gather = flat-merge custom gather strategy
 *   concurrency = 4 (all providers in-flight simultaneously)
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { GatherStrategies, GatherStrategy } from '../../src/core/GatherStrategies.js';
import type { GatherExecution } from '../../src/core/GatherStrategies.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { GatherConfig } from '../../src/entities/dag/GatherConfig.js';
import type { JsonObject } from '../../src/entities/json.js';
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

  protected override snapshotData(): JsonObject {
    return {
      'providers':      [...this.providers],
      'providerResult': this.providerResult,
      'results':        [...this.results],
      'failMessages':   [...this.failMessages],
    };
  }

  protected override restoreData(snap: JsonObject): void {
    if (Array.isArray(snap['providers']))              this.providers     = snap['providers'] as string[];
    if (typeof snap['providerResult'] === 'string')    this.providerResult = snap['providerResult'];
    if (Array.isArray(snap['results']))                this.results        = snap['results'] as string[];
    if (Array.isArray(snap['failMessages']))           this.failMessages   = snap['failMessages'] as string[];
  }
}

// ── dispatch node ─────────────────────────────────────────────────────────────
// Reads currentItem (the provider descriptor) and produces a per-provider
// result. Three providers succeed, one returns 'empty'.

const dispatchNode: NodeInterface<HeterogeneousState, 'success' | 'empty'> = {
  'name': 'dispatch',
  'outputs': ['success', 'empty'],
  async execute(state) {
    const provider = state.getMetadata<string>('currentItem') ?? 'unknown';
    switch (provider) {
      case 'alpha': {
        state.providerResult = 'result-from-alpha';
        return { 'output': 'success' };
      }
      case 'beta': {
        state.providerResult = 'result-from-beta';
        return { 'output': 'success' };
      }
      case 'gamma': {
        state.providerResult = 'result-from-gamma';
        return { 'output': 'success' };
      }
      case 'delta': {
        // delta returns empty — no results from this provider.
        state.failMessages = [...state.failMessages, 'delta: no results'];
        return { 'output': 'empty' };
      }
      default: {
        return { 'output': 'empty' };
      }
    }
  },
};

// ── custom gather strategy ───────────────────────────────────────────────────
// Flat-merges each clone's `providerResult` into the parent `results` array
// and merges `errors` from clones that failed.

class FlatMergeGather extends GatherStrategy {
  readonly name = 'flat-merge-test';

  async apply<TState extends NodeStateInterface>(
    _config: GatherConfig,
    execution: GatherExecution<TState>,
  ): Promise<void> {
    const parent = execution.state as unknown as HeterogeneousState;
    const merged: string[] = [...parent.results];
    const mergedFails: string[] = [...parent.failMessages];

    for (const record of execution.records) {
      const cloneState = record.cloneState as unknown as HeterogeneousState;
      if (cloneState.providerResult.length > 0) {
        merged.push(cloneState.providerResult);
      }
      for (const msg of cloneState.failMessages) {
        mergedFails.push(msg);
      }
    }

    parent.results      = merged;
    parent.failMessages = mergedFails;
  }
}

GatherStrategies.register(new FlatMergeGather());

// ── tests ─────────────────────────────────────────────────────────────────────

void describe('heterogeneous scatter (descriptor source + dispatching body)', () => {
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

    const emptyDispatch: NodeInterface<HeterogeneousState, 'success' | 'empty'> = {
      'name': 'empty-dispatch',
      'outputs': ['success', 'empty'],
      async execute() {
        return { 'output': 'empty' };
      },
    };
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
    assert.equal(result.state.lifecycle.kind, 'failed', 'flow failed when all providers return empty');
  });

  void it('builder emits a well-formed ScatterNode for a descriptor source', () => {
    const dag = new DAGBuilder('hetero-builder-check', '1.0')
      .scatter('fan-out', 'providers', dispatchNode, {
        'success': 'end',
        'error':   'end',
        'empty':   'end',
      }, {
        'concurrency': 4,
        'gather':  { 'strategy': 'flat-merge-test' },
        'reducer': 'any-success',
      })
      .terminal('end', { 'outcome': 'completed' })
      .build();

    const scatterNode = dag.nodes.find((n) => n['@type'] === 'ScatterNode');
    assert.ok(scatterNode !== undefined, 'ScatterNode present in built DAG');
    assert.equal(scatterNode.name, 'fan-out');
    // body is a node reference (the dispatch node)
    assert.ok('node' in scatterNode.body, 'body is a node reference');
    assert.equal((scatterNode.body as { node: string }).node, 'dispatch');
    assert.equal(scatterNode.source, 'providers');
    assert.equal(scatterNode.concurrency, 4);
    assert.equal(scatterNode.gather.strategy, 'flat-merge-test');
    assert.equal(scatterNode.reducer, 'any-success');
  });
});
