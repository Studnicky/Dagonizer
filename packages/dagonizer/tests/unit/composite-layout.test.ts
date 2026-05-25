import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAG_CONTEXT } from '../../src/entities/index.js';
import type { DAG } from '../../src/entities/index.js';
import { CompositeLayout } from '../../src/viz/CompositeLayout.js';

// ── Helper: build a minimal DAG ────────────────────────────────────────────

function singleNode(name: string, outputs: Record<string, string | null>): DAG['nodes'][0] {
  return {
    '@id':    `urn:noocodex:dag:test/node/${name}`,
    '@type':  'SingleNode',
    'name':   name,
    'node':   name,
    'outputs': outputs,
  };
}

function makeDAG(name: string, entrypoint: string, nodes: DAG['nodes']): DAG {
  return {
    '@context': DAG_CONTEXT,
    '@id':      `urn:noocodex:dag:${name}`,
    '@type':    'DAG',
    'name':     name,
    'version':  '1',
    'entrypoint': entrypoint,
    'nodes': nodes,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

void describe('CompositeLayout.compute', () => {
  void it('linear DAG: A→B→C positions form a top-down sequence (A smallest y)', () => {
    const dag = makeDAG('linear', 'A', [
      singleNode('A', { "next": 'B' }),
      singleNode('B', { "next": 'C' }),
      singleNode('C', { "done": null }),
    ]);

    const { positions } = CompositeLayout.compute(dag);

    const posA = positions.get('A');
    const posB = positions.get('B');
    const posC = positions.get('C');

    assert.ok(posA !== undefined, 'A must have a position');
    assert.ok(posB !== undefined, 'B must have a position');
    assert.ok(posC !== undefined, 'C must have a position');

    assert.ok(posA.y < posB.y, `A.y (${posA.y}) must be < B.y (${posB.y})`);
    assert.ok(posB.y < posC.y, `B.y (${posB.y}) must be < C.y (${posC.y})`);
  });

  void it('embedded-DAG: inner children sit between predecessor and successor in y; entry has smallest y in subgraph', () => {
    // inner DAG: entry-node → middle-node → exit-node
    const innerDAG = makeDAG('inner', 'entry-node', [
      singleNode('entry-node',  { "go": 'middle-node' }),
      singleNode('middle-node', { "go": 'exit-node' }),
      singleNode('exit-node',   { "done": null }),
    ]);

    // outer DAG: before → embed-dag-placement → after
    const outerDAG: DAG = makeDAG('outer', 'before', [
      singleNode('before', { "go": 'embed' }),
      {
        '@id':    'urn:noocodex:dag:outer/node/embed',
        '@type':  'EmbeddedDAGNode',
        'name':   'embed',
        'dag':    'inner',
        'outputs': { "done": 'after' },
      },
      singleNode('after', { "done": null }),
    ]);

    const embeddedDAGs = new Map<string, DAG>([['inner', innerDAG]]);
    const { positions } = CompositeLayout.compute(outerDAG, embeddedDAGs);

    const posBefore  = positions.get('before');
    const posEmbed   = positions.get('embed');
    const posAfter   = positions.get('after');
    const posEntry   = positions.get('embed/entry-node');
    const posMiddle  = positions.get('embed/middle-node');
    const posExit    = positions.get('embed/exit-node');

    assert.ok(posBefore !== undefined,  'before must have a position');
    assert.ok(posEmbed  !== undefined,  'embed compound must have a position');
    assert.ok(posAfter  !== undefined,  'after must have a position');
    assert.ok(posEntry  !== undefined,  'embed/entry-node must have a position');
    assert.ok(posMiddle !== undefined,  'embed/middle-node must have a position');
    assert.ok(posExit   !== undefined,  'embed/exit-node must have a position');

    // Outer ordering: before < embed-area < after.
    assert.ok(posBefore.y < posEmbed.y,  `before (${posBefore.y}) < embed (${posEmbed.y})`);
    assert.ok(posEmbed.y  < posAfter.y,  `embed (${posEmbed.y}) < after (${posAfter.y})`);

    // Inner ordering: entry < middle < exit (top-down).
    assert.ok(posEntry.y  < posMiddle.y, `entry (${posEntry.y}) < middle (${posMiddle.y})`);
    assert.ok(posMiddle.y < posExit.y,   `middle (${posMiddle.y}) < exit (${posExit.y})`);

    // Entry is the topmost child in the subgraph (min y among embedded children).
    const minChildY = Math.min(posEntry.y, posMiddle.y, posExit.y);
    assert.equal(posEntry.y, minChildY, `entry-node must have smallest y among embedded children`);

    // All embedded children sit vertically between before and after.
    assert.ok(posBefore.y < posEntry.y, `before.y < entry-node.y`);
    assert.ok(posExit.y   < posAfter.y, `exit-node.y < after.y`);
  });

  void it('parallel placement: all 3 children share the same y, distributed horizontally', () => {
    const dag: DAG = makeDAG('par', 'par-group', [
      {
        '@id':     'urn:noocodex:dag:par/node/par-group',
        '@type':   'ParallelNode',
        'name':    'par-group',
        'nodes':   ['alpha', 'beta', 'gamma'],
        'combine': 'collect',
        'outputs': { "success": null },
      },
    ]);

    const { positions } = CompositeLayout.compute(dag);

    const posAlpha = positions.get('alpha');
    const posBeta  = positions.get('beta');
    const posGamma = positions.get('gamma');
    const posGroup = positions.get('par-group');

    assert.ok(posAlpha !== undefined, 'alpha must have a position');
    assert.ok(posBeta  !== undefined, 'beta must have a position');
    assert.ok(posGamma !== undefined, 'gamma must have a position');
    assert.ok(posGroup !== undefined, 'par-group must have a position');

    // All three parallel children must share the same y (single horizontal rank).
    assert.equal(posAlpha.y, posBeta.y,  `alpha.y (${posAlpha.y}) === beta.y (${posBeta.y})`);
    assert.equal(posBeta.y,  posGamma.y, `beta.y (${posBeta.y}) === gamma.y (${posGamma.y})`);

    // They must be distributed horizontally (distinct x values).
    assert.notEqual(posAlpha.x, posBeta.x,  'alpha and beta must have different x');
    assert.notEqual(posBeta.x,  posGamma.x, 'beta and gamma must have different x');
    assert.notEqual(posAlpha.x, posGamma.x, 'alpha and gamma must have different x');
  });
});
