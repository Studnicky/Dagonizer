/**
 * WellFormedValidator: unit tests for DAG well-formedness rules.
 *
 * Rules tested:
 *   1. No bare null flow-ends on non-parallel-member placements.
 *   2. All non-null targets must resolve to a placement name in dag.nodes.
 *   3. Structural guards: ScatterNode source, EmbeddedDAGNode dag, TerminalNode outcome.
 *   4. Parallel members with null routes → no violation (legal "collected back").
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/dag/DAG.js';
import { WellFormedValidator } from '../../src/validation/WellFormedValidator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSingleNodePlacement(name: string, outputs: Record<string, string | null>): DAG['nodes'][number] {
  return {
    '@id':   `urn:noocodex:dag:test/node/${name}`,
    '@type': 'SingleNode',
    'name':  name,
    'node':  name,
    'outputs': outputs,
  };
}

function makeTerminal(name: string, outcome: 'completed' | 'failed'): DAG['nodes'][number] {
  return {
    '@id':     `urn:noocodex:dag:test/node/${name}`,
    '@type':   'TerminalNode',
    'name':    name,
    'outcome': outcome,
  };
}

function baseDAG(nodes: DAG['nodes']): DAG {
  return {
    '@context':   DAG_CONTEXT,
    '@id':        'urn:noocodex:dag:test',
    '@type':      'DAG',
    'name':       'test',
    'version':    '1',
    'entrypoint': nodes[0]?.name ?? 'start',
    'nodes':      nodes,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('WellFormedValidator', () => {

  // ── Rule 1: clean DAG → no violations ───────────────────────────────────

  void it('returns no violations for a well-formed DAG with TerminalNode end', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'ok': 'end' }),
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0, `Expected no violations; got: ${JSON.stringify(violations)}`);
  });

  void it('returns no violations for a chained DAG with TerminalNode end', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('a', { 'done': 'b' }),
      makeSingleNodePlacement('b', { 'done': 'end' }),
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Rule 1: null on a non-parallel member → violation ────────────────────

  void it('reports a violation when a non-parallel placement routes to null', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'done': null }),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    // Violation message names the placement, the route, and the remedy.
    assert.match((violations[0] ?? ''), /placement 'start'/i);
    assert.match((violations[0] ?? ''), /route 'done'/i);
    assert.match((violations[0] ?? ''), /TerminalNode/i);
  });

  void it('reports one violation per null route on the same placement', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'ok': null, 'fail': null }),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 2);
  });

  // ── Rule 1 exception: parallel members with null routes → no violation ───

  void it('does NOT report a violation for parallel-member null routes', () => {
    // The parallel members 'worker-a' and 'worker-b' are listed in the
    // ParallelNode's nodes array; their null routes are "collected back".
    const dag = baseDAG([
      {
        '@id':     'urn:noocodex:dag:test/node/parallel-gate',
        '@type':   'ParallelNode',
        'name':    'parallel-gate',
        'nodes':   ['worker-a', 'worker-b'],
        'combine': 'collect',
        'outputs': { 'success': 'end', 'error': 'end' },
      },
      makeSingleNodePlacement('worker-a', { 'ok': null }),
      makeSingleNodePlacement('worker-b', { 'fail': null }),
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0, `Expected no violations; got: ${JSON.stringify(violations)}`);
  });

  void it('allows a parallel member with multiple null routes (success + empty)', () => {
    const dag = baseDAG([
      {
        '@id':     'urn:noocodex:dag:test/node/fan-out',
        '@type':   'ParallelNode',
        'name':    'fan-out',
        'nodes':   ['scout'],
        'combine': 'collect',
        'outputs': { 'success': 'end' },
      },
      makeSingleNodePlacement('scout', { 'success': null, 'empty': null }),
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Rule 2: dangling target → violation ──────────────────────────────────

  void it('reports a violation when an output targets a non-existent placement', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'done': 'ghost' }),  // 'ghost' does not exist
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    assert.match((violations[0] ?? ''), /placement 'start'/i);
    assert.match((violations[0] ?? ''), /'ghost'/);
    assert.match((violations[0] ?? ''), /does not exist/i);
  });

  void it('reports one violation per dangling target', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'ok': 'also-ghost', 'fail': 'ghost-too' }),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 2);
  });

  // ── Combined: null AND dangling in same DAG ───────────────────────────────

  void it('reports violations for both null routes and dangling targets together', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'ok': null, 'fail': 'nowhere' }),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 2);
  });

  // ── Rule 3: ScatterNode checks ────────────────────────────────────────────

  void it('reports no violation for a well-formed ScatterNode', () => {
    const dag = baseDAG([
      {
        '@id':    'urn:noocodex:dag:test/node/scatter',
        '@type':  'ScatterNode',
        'name':   'scatter',
        'body':   { 'node': 'worker' },
        'source': 'items',
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      },
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Rule 3: EmbeddedDAGNode checks ───────────────────────────────────────

  void it('reports no violation for a well-formed EmbeddedDAGNode', () => {
    const dag = baseDAG([
      {
        '@id':    'urn:noocodex:dag:test/node/embed',
        '@type':  'EmbeddedDAGNode',
        'name':   'embed',
        'dag':    'child-dag',
        'outputs': { 'success': 'end', 'error': 'end' },
      },
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Rule: TerminalNode with valid outcome ─────────────────────────────────

  void it('accepts a TerminalNode with outcome completed', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'ok': 'end' }),
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  void it('accepts a TerminalNode with outcome failed', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('start', { 'ok': 'end' }),
      makeTerminal('end', 'failed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Self-loop (legal targeting) ───────────────────────────────────────────

  void it('accepts a self-loop (retry pattern) as a valid target', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('fetch', { 'success': 'end', 'retry': 'fetch' }),  // self-loop on retry
      makeTerminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Multiple placements mixed clean and violating ────────────────────────

  void it('reports violations only for offending placements in a mixed DAG', () => {
    const dag = baseDAG([
      makeSingleNodePlacement('a', { 'ok': 'b' }),                // clean
      makeSingleNodePlacement('b', { 'ok': null }),                // VIOLATION: null route
      makeSingleNodePlacement('c', { 'ok': 'a' }),                 // clean (c not reachable, but structurally fine)
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    assert.match((violations[0] ?? ''), /placement 'b'/i);
  });

  // ── ParallelNode routing to TerminalNode (legal) ──────────────────────────

  void it('returns no violations for a ParallelNode whose outputs route to a TerminalNode', () => {
    const dag = baseDAG([
      {
        '@id':     'urn:noocodex:dag:test/node/parallel-gate',
        '@type':   'ParallelNode',
        'name':    'parallel-gate',
        'nodes':   ['w1', 'w2'],
        'combine': 'all-success',
        'outputs': { 'success': 'done', 'error': 'done' },
      },
      makeSingleNodePlacement('w1', { 'ok': null }),
      makeSingleNodePlacement('w2', { 'ok': null }),
      makeTerminal('done', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });
});
