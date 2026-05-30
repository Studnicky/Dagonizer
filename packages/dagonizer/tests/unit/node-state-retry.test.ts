/**
 * NodeStateBase retry-attempt concept.
 *
 * Retry is a flow shape, not an in-node `RetryPolicy`: the attempt counter
 * lives on the conceptual-root state so any consumer can route to a `retry`
 * output (loop) or `salvage` output (give up) based on a bounded budget. The
 * counter is part of the snapshot, so a retry budget survives checkpoint/resume.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NodeStateBase } from '../../src/NodeStateBase.js';

void describe('NodeStateBase — retry attempts', () => {
  void it('records and reads per-key attempt counts independently', () => {
    const state = new NodeStateBase();

    assert.equal(state.retriesFor('extract-query'), 0);
    assert.equal(state.recordAttempt('extract-query'), 1);
    assert.equal(state.recordAttempt('extract-query'), 2);
    assert.equal(state.recordAttempt('decide-tools'), 1);

    assert.equal(state.retriesFor('extract-query'), 2);
    assert.equal(state.retriesFor('decide-tools'), 1);
    assert.equal(state.retriesFor('never-seen'), 0);
  });

  void it('clearAttempts resets one key without touching others', () => {
    const state = new NodeStateBase();
    state.recordAttempt('a');
    state.recordAttempt('a');
    state.recordAttempt('b');

    state.clearAttempts('a');

    assert.equal(state.retriesFor('a'), 0);
    assert.equal(state.retriesFor('b'), 1);
  });

  void it('withinRetryBudget records an attempt and reports remaining budget', () => {
    const state = new NodeStateBase();
    const key = 'rank-candidates';
    const MAX = 3;

    // attempts 1 and 2 are under budget → retry; attempt 3 hits the ceiling → salvage.
    assert.equal(state.withinRetryBudget(key, MAX), true);  // attempt 1
    assert.equal(state.withinRetryBudget(key, MAX), true);  // attempt 2
    assert.equal(state.withinRetryBudget(key, MAX), false); // attempt 3 → salvage
    assert.equal(state.retriesFor(key), 3);
  });

  void it('snapshot/restore round-trips the retry budget', () => {
    const state = new NodeStateBase();
    state.recordAttempt('extract-query');
    state.recordAttempt('extract-query');
    state.recordAttempt('decide-tools');

    const snap = state.snapshot();
    assert.deepEqual(snap['retries'], { 'extract-query': 2, 'decide-tools': 1 });

    const restored = NodeStateBase.restore(snap);
    assert.equal(restored.retriesFor('extract-query'), 2);
    assert.equal(restored.retriesFor('decide-tools'), 1);

    // A resumed node continues counting from where it paused.
    assert.equal(restored.withinRetryBudget('extract-query', 3), false); // attempt 3 → salvage
  });
});
