/**
 * WellFormedValidator: unit tests for DAG well-formedness rules.
 *
 * Rules tested:
 *   1. All output targets must resolve to a placement name in dag.nodes.
 *   2. Entrypoints target real placements.
 *   3. Gather sources are declared by entrypoint labels or producer placements.
 *   4. Structural guards: duplicate placement names and TerminalNode outcome.
 *
 * WellFormedValidator receives only schema-valid DAGs (outputs values are
 * strings, never null); null routes are schema-invalid and rejected by
 * Validator.dag before this validator ever runs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
import { WellFormedValidator } from '../../src/validation/WellFormedValidator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TestPlacement {
  private constructor() {}
  static singleNode(name: string, outputs: Record<string, string>): DAGType['nodes'][number] {
    return {
      '@id':   `urn:noocodex:dag:test/node/${name}`,
      '@type': 'SingleNode',
      'name':  name,
      'node':  name,
      'outputs': outputs,
    };
  }

  static terminal(name: string, outcome: 'completed' | 'failed'): DAGType['nodes'][number] {
    return {
      '@id':     `urn:noocodex:dag:test/node/${name}`,
      '@type':   'TerminalNode',
      'name':    name,
      'outcome': outcome,
    };
  }
}

class TestDagFixture {
  private constructor() {}

  static ofNodes(nodes: DAGType['nodes']): DAGType {
    return {
      '@context':   DAG_CONTEXT,
      '@id':        'urn:noocodex:dag:test',
      '@type':      'DAG',
      'name':       'test',
      'version':    '1',
      'entrypoints': { 'main': nodes[0]?.name ?? 'start' },
      'nodes':      nodes,
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void describe('WellFormedValidator', () => {

  // ── Rule 1: clean DAG → no violations ───────────────────────────────────

  void it('returns no violations for a well-formed DAG with TerminalNode end', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('start', { 'ok': 'end' }),
      TestPlacement.terminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0, `Expected no violations; got: ${JSON.stringify(violations)}`);
  });

  void it('returns no violations for a chained DAG with TerminalNode end', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('a', { 'done': 'b' }),
      TestPlacement.singleNode('b', { 'done': 'end' }),
      TestPlacement.terminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Rule 1: dangling target → violation ──────────────────────────────────

  void it('reports a violation when an output targets a non-existent placement', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('start', { 'done': 'ghost' }),  // 'ghost' does not exist
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    assert.match((violations[0] ?? ''), /placement 'start'/i);
    assert.match((violations[0] ?? ''), /'ghost'/);
    assert.match((violations[0] ?? ''), /does not exist/i);
  });

  void it('reports one violation per dangling target', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('start', { 'ok': 'also-ghost', 'fail': 'ghost-too' }),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 2);
  });

  void it('reports entrypoint labels and targets that are not valid DAG roots', () => {
    const dag: DAGType = {
      ...TestDagFixture.ofNodes([
        TestPlacement.singleNode('start', { 'done': 'end' }),
        TestPlacement.terminal('end', 'completed'),
      ]),
      'entrypoints': { '': 'start', 'missing': 'ghost' },
    };
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 2);
    assert.match((violations[0] ?? ''), /Entrypoint label must be non-empty/u);
    assert.match((violations[1] ?? ''), /Entrypoint 'missing' targets 'ghost'/u);
  });

  void it('reports duplicate placement names', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('start', { 'done': 'end' }),
      TestPlacement.terminal('start', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.some((violation) => violation.includes("Duplicate placement name 'start'")), true);
  });

  // ── Rule 2: ScatterNode checks ────────────────────────────────────────────

  void it('reports no violation for a well-formed ScatterNode', () => {
    const dag = TestDagFixture.ofNodes([
      {
        '@id':    'urn:noocodex:dag:test/node/scatter',
        '@type':  'ScatterNode',
        'name':   'scatter',
        'body':   { 'node': 'worker' },
        'source': 'items',
        'gather': { 'strategy': 'discard' },
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      },
      TestPlacement.terminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Rule 2: EmbeddedDAGNode checks ───────────────────────────────────────

  void it('reports no violation for a well-formed EmbeddedDAGNode', () => {
    const dag = TestDagFixture.ofNodes([
      {
        '@id':    'urn:noocodex:dag:test/node/embed',
        '@type':  'EmbeddedDAGNode',
        'name':   'embed',
        'dag':    'child-dag',
        'outputs': { 'success': 'end', 'error': 'end' },
      },
      TestPlacement.terminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  void it('accepts gather sources declared by entrypoint labels and producer placements', () => {
    const dag: DAGType = {
      ...TestDagFixture.ofNodes([
        TestPlacement.singleNode('left-node', { 'success': 'join' }),
        TestPlacement.singleNode('right-producer', { 'success': 'join' }),
        {
          '@id': 'urn:noocodex:dag:test/node/join',
          '@type': 'GatherNode',
          'name': 'join',
          'sources': ['left-label', 'right-producer'],
          'gather': { 'strategy': 'discard' },
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        TestPlacement.terminal('end', 'completed'),
      ]),
      'entrypoints': { 'left-label': 'left-node', 'right-label': 'right-producer' },
    };
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  void it('reports gather sources that are not declared by an entrypoint or producer placement', () => {
    const dag: DAGType = {
      ...TestDagFixture.ofNodes([
        TestPlacement.singleNode('start', { 'success': 'join' }),
        {
          '@id': 'urn:noocodex:dag:test/node/join',
          '@type': 'GatherNode',
          'name': 'join',
          'sources': ['main', 'missing-source'],
          'gather': { 'strategy': 'discard' },
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        TestPlacement.terminal('end', 'completed'),
      ]),
    };
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    assert.match((violations[0] ?? ''), /GatherNode 'join': source 'missing-source'/u);
  });

  void it('reports gather quorum policies that cannot be satisfied', () => {
    const dag: DAGType = {
      ...TestDagFixture.ofNodes([
        TestPlacement.singleNode('left-node', { 'success': 'join' }),
        TestPlacement.singleNode('right-node', { 'success': 'join' }),
        {
          '@id': 'urn:noocodex:dag:test/node/join',
          '@type': 'GatherNode',
          'name': 'join',
          'sources': ['left', 'right'],
          'gather': { 'strategy': 'discard' },
          'policy': { 'mode': 'quorum', 'quorum': 3 },
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        TestPlacement.terminal('end', 'completed'),
      ]),
      'entrypoints': { 'left': 'left-node', 'right': 'right-node' },
    };
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    assert.match((violations[0] ?? ''), /policy\.quorum 3 exceeds source count 2/u);
  });

  void it('reports gather quorum values ignored by non-quorum policies', () => {
    const dag: DAGType = {
      ...TestDagFixture.ofNodes([
        TestPlacement.singleNode('left-node', { 'success': 'join' }),
        {
          '@id': 'urn:noocodex:dag:test/node/join',
          '@type': 'GatherNode',
          'name': 'join',
          'sources': ['left'],
          'gather': { 'strategy': 'discard' },
          'policy': { 'mode': 'any', 'quorum': 1 },
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        TestPlacement.terminal('end', 'completed'),
      ]),
      'entrypoints': { 'left': 'left-node' },
    };
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    assert.match((violations[0] ?? ''), /policy\.quorum is only valid when policy\.mode is 'quorum'/u);
  });

  // ── Rule: TerminalNode with valid outcome ─────────────────────────────────

  void it('accepts a TerminalNode with outcome completed', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('start', { 'ok': 'end' }),
      TestPlacement.terminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  void it('accepts a TerminalNode with outcome failed', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('start', { 'ok': 'end' }),
      TestPlacement.terminal('end', 'failed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Self-loop (legal targeting) ───────────────────────────────────────────

  void it('accepts a self-loop (retry pattern) as a valid target', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('fetch', { 'success': 'end', 'retry': 'fetch' }),  // self-loop on retry
      TestPlacement.terminal('end', 'completed'),
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 0);
  });

  // ── Multiple placements mixed clean and violating ────────────────────────

  void it('reports violations only for offending placements in a mixed DAG', () => {
    const dag = TestDagFixture.ofNodes([
      TestPlacement.singleNode('a', { 'ok': 'b' }),                          // clean
      TestPlacement.singleNode('b', { 'ok': 'nowhere' }),                    // VIOLATION: dangling target
      TestPlacement.singleNode('c', { 'ok': 'a' }),                          // clean
    ]);
    const violations = WellFormedValidator.check(dag);
    assert.equal(violations.length, 1);
    assert.match((violations[0] ?? ''), /placement 'b'/i);
  });
});
