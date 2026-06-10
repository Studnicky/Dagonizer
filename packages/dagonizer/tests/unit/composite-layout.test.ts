import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAG_CONTEXT } from '../../src/entities/index.js';
import type { DAG } from '../../src/entities/index.js';
import { CompositeLayout } from '../../src/viz/CompositeLayout.js';

// ── Helper: build a minimal DAG ────────────────────────────────────────────

function singleNode(name: string, outputs: Record<string, string>): DAG['nodes'][0] {
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
  void it('linear DAG: A→B→C positions form a top-down sequence (A smallest y)', async () => {
    const dag = makeDAG('linear', 'A', [
      singleNode('A', { "next": 'B' }),
      singleNode('B', { "next": 'C' }),
      singleNode('C', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    const { positions } = await CompositeLayout.compute(dag);

    const posA = positions.get('A');
    const posB = positions.get('B');
    const posC = positions.get('C');

    assert.ok(posA !== undefined, 'A must have a position');
    assert.ok(posB !== undefined, 'B must have a position');
    assert.ok(posC !== undefined, 'C must have a position');

    assert.ok(posA.y < posB.y, `A.y (${posA.y}) must be < B.y (${posB.y})`);
    assert.ok(posB.y < posC.y, `B.y (${posB.y}) must be < C.y (${posC.y})`);
  });

  void it('2-level nesting: sibling compounds do not overlap each other', async () => {
    // inner DAGs: each has two leaf nodes
    const innerA = makeDAG('innerA', 'a1', [
      singleNode('a1', { "go": 'a2' }),
      singleNode('a2', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);
    const innerB = makeDAG('innerB', 'b1', [
      singleNode('b1', { "go": 'b2' }),
      singleNode('b2', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    // outer DAG: embedA then embedB in sequence
    const outerDAG: DAG = makeDAG('outer2', 'embedA', [
      {
        '@id':    'urn:noocodex:dag:outer2/node/embedA',
        '@type':  'EmbeddedDAGNode',
        'name':   'embedA',
        'dag':    'innerA',
        'outputs': { "done": 'embedB' },
      },
      {
        '@id':    'urn:noocodex:dag:outer2/node/embedB',
        '@type':  'EmbeddedDAGNode',
        'name':   'embedB',
        'dag':    'innerB',
        'outputs': { "done": 'end', "error": 'end' },
      },
      { '@id': 'urn:noocodex:dag:outer2/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    const embeddedDAGs = new Map<string, DAG>([['innerA', innerA], ['innerB', innerB]]);
    const { positions } = await CompositeLayout.compute(outerDAG, embeddedDAGs);

    // embedA compound center
    const posEmbedA = positions.get('embedA');
    // embedB compound center
    const posEmbedB = positions.get('embedB');
    // children of embedA
    const posA1 = positions.get('embedA/a1');
    const posA2 = positions.get('embedA/a2');
    // children of embedB
    const posB1 = positions.get('embedB/b1');
    const posB2 = positions.get('embedB/b2');

    assert.ok(posEmbedA !== undefined, 'embedA compound must have a position');
    assert.ok(posEmbedB !== undefined, 'embedB compound must have a position');
    assert.ok(posA1 !== undefined, 'embedA/a1 must have a position');
    assert.ok(posA2 !== undefined, 'embedA/a2 must have a position');
    assert.ok(posB1 !== undefined, 'embedB/b1 must have a position');
    assert.ok(posB2 !== undefined, 'embedB/b2 must have a position');

    // The two sibling compounds should be ordered top-to-bottom (embedA before embedB).
    assert.ok(posEmbedA.y < posEmbedB.y,
      `embedA.y (${posEmbedA.y}) must be < embedB.y (${posEmbedB.y})`);

    // Non-overlap: the lowest child of embedA must be above the highest child of embedB.
    // We use a half-height margin of 30 (half of DEFAULT_NODE_HEIGHT) for node bodies.
    const HALF_H = 30;
    const lowestInA = Math.max(posA1.y + HALF_H, posA2.y + HALF_H);
    const highestInB = Math.min(posB1.y - HALF_H, posB2.y - HALF_H);
    assert.ok(
      lowestInA < highestInB,
      `lowest edge of embedA children (${lowestInA}) must be above highest edge of embedB children (${highestInB})`,
    );
  });

  void it('ScatterNode (body.dag): inner children sit between predecessor and successor in y; entry has smallest y in subgraph', async () => {
    // inner DAG: entry-node → middle-node → exit-node
    const innerDAG = makeDAG('inner', 'entry-node', [
      singleNode('entry-node',  { "go": 'middle-node' }),
      singleNode('middle-node', { "go": 'exit-node' }),
      singleNode('exit-node',   { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    // outer DAG: before → ScatterNode(body.dag=inner) → after
    const outerDAG: DAG = makeDAG('outer', 'before', [
      singleNode('before', { "go": 'embed' }),
      {
        '@id':    'urn:noocodex:dag:outer/node/embed',
        '@type':  'EmbeddedDAGNode',
        'name':   'embed',
        'dag':    'inner',
        'outputs': { "done": 'after' },
      },
      singleNode('after', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:outer/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    const embeddedDAGs = new Map<string, DAG>([['inner', innerDAG]]);
    const { positions } = await CompositeLayout.compute(outerDAG, embeddedDAGs);

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

});
