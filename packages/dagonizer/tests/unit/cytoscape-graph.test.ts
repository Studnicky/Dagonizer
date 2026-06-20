import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type cytoscape from 'cytoscape';

import type { DAGType } from '../../src/entities/index.js';
import { CompositeLayout } from '../../src/viz/CompositeLayout.js';
import { CytoscapeGraph } from '../../src/viz/CytoscapeGraph.js';
import { TestDag } from '../_support/TestDag.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function singleNode(name: string, outputs: Record<string, string>): DAGType['nodes'][0] {
  return {
    '@id':    `urn:noocodex:dag:test/node/${name}`,
    '@type':  'SingleNode',
    'name':   name,
    'node':   name,
    'outputs': outputs,
  };
}

/** A captured cytoscape config plus a record of fake-Core method calls. */
type Capture = {
  config: cytoscape.CytoscapeOptions | null;
  batchCalls: number;
}

/**
 * `CytoscapeGraph` subclass that overrides the `construct` hook to record the
 * config it is given and return a minimal fake `Core` implementing only what
 * `CytoscapeGraph` calls (`batch` + `nodes().style`). Real cytoscape needs a
 * DOM/canvas, which is not available under `node --test`; overriding `construct`
 * (the sanctioned extension point that replaced the former injected factory)
 * exercises the assembly path without loading the optional `cytoscape` peer.
 */
class StubCytoscapeGraph extends CytoscapeGraph {
  readonly #capture: Capture;

  constructor(
    capture: Capture,
    container: NonNullable<cytoscape.CytoscapeOptions['container']>,
    dag: DAGType,
  ) {
    super(container, dag);
    this.#capture = capture;
  }

  protected override construct(options: cytoscape.CytoscapeOptions): Promise<cytoscape.Core> {
    this.#capture.config = options;
    const fakeNodes = { "style": (): void => { /* no-op */ } };
    const capture = this.#capture;
    const fakeCore = {
      "batch": (fn: () => void): void => { capture.batchCalls += 1; fn(); },
      "nodes": (): typeof fakeNodes => fakeNodes,
    };
    // Constructs intentionally-invalid input: fakeCore omits the full cytoscape.Core surface;
    // only the methods called by CytoscapeGraph (batch + nodes) are implemented.
    return Promise.resolve(fakeCore as unknown as cytoscape.Core);
  }
}

// Constructs intentionally-invalid input: fakeContainer stands in for a DOM element;
// cytoscape.CytoscapeOptions['container'] is an HTMLElement in a real DOM context.
const fakeContainer = {} as unknown as NonNullable<cytoscape.CytoscapeOptions['container']>;

/** Read the elements array passed to the stub factory as plain records. */
function capturedElements(capture: Capture): Array<{ group?: string; data?: { id?: string }; position?: { x: number; y: number } }> {
  const els = capture.config?.elements;
  return Array.isArray(els) ? els as Array<{ group?: string; data?: { id?: string }; position?: { x: number; y: number } }> : [];
}

/** Read the stylesheet array passed to the stub factory as plain records. */
function capturedStyle(capture: Capture): Array<{ selector?: string; style?: Record<string, unknown> }> {
  const style = capture.config?.style;
  return Array.isArray(style) ? style as Array<{ selector?: string; style?: Record<string, unknown> }> : [];
}

// ── Tests ────────────────────────────────────────────────────────────────

void describe('CytoscapeGraph.mount', () => {
  void it('mounts: resolves the Core, sets .cy, and invokes onReady', async () => {
    const dag = TestDag.of('linear', 'A', [
      singleNode('A', { "next": 'B' }),
      singleNode('B', { "next": 'C' }),
      singleNode('C', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    let onReadyCalls = 0;

    class RecordingGraph extends StubCytoscapeGraph {
      protected override onReady(): void { onReadyCalls += 1; }
    }

    const graph = new RecordingGraph(capture, fakeContainer, dag);
    const cy = await graph.mount();

    assert.ok(cy !== null, 'mount must return a Core');
    assert.equal(graph.cy, cy, '.cy must be the mounted Core');
    assert.equal(onReadyCalls, 1, 'onReady must be called exactly once');
    assert.equal(capture.batchCalls, 2, 'enforceVisibility must run two batches');
  });

  void it('applies pre-computed positions to every node element', async () => {
    const dag = TestDag.of('linear', 'A', [
      singleNode('A', { "next": 'B' }),
      singleNode('B', { "next": 'C' }),
      singleNode('C', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new StubCytoscapeGraph(capture, fakeContainer, dag);
    await graph.mount();

    const nodes = capturedElements(capture).filter((el) => el.group === 'nodes');
    assert.ok(nodes.length >= 3, 'at least A, B, C must be present');
    for (const node of nodes) {
      assert.ok(node.position !== undefined, `node ${node.data?.id} must have a position`);
      assert.ok(Number.isFinite(node.position?.x), `node ${node.data?.id} x must be finite`);
      assert.ok(Number.isFinite(node.position?.y), `node ${node.data?.id} y must be finite`);
    }
  });

  void it('stylesheet uses explicit numeric node sizing — never the string "label"', async () => {
    const dag = TestDag.of('mini', 'A', [
      singleNode('A', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);
    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new StubCytoscapeGraph(capture, fakeContainer, dag);
    await graph.mount();

    const style = capturedStyle(capture);
    const nodeBase = style.find((rule) => rule.selector === 'node');
    assert.ok(nodeBase !== undefined, 'a base "node" selector must exist');
    assert.equal(typeof nodeBase.style?.['width'], 'number', 'node width must be numeric');
    assert.equal(typeof nodeBase.style?.['height'], 'number', 'node height must be numeric');

    // Regression guard: the deprecated 'label' auto-size value (which makes
    // self-loop nodes invisible) must never appear for width or height.
    for (const rule of style) {
      assert.notEqual(rule.style?.['width'], 'label', `${rule.selector} width must not be 'label'`);
      assert.notEqual(rule.style?.['height'], 'label', `${rule.selector} height must not be 'label'`);
    }
  });

  void it('self-loop (retry-to-self) node still renders and enforceVisibility does not throw', async () => {
    // 'retry' route targets the node itself → a cytoscape self-loop edge.
    const dag = TestDag.of('retry', 'work', [
      singleNode('work', { "success": 'end', "retry": 'work' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new StubCytoscapeGraph(capture, fakeContainer, dag);
    await graph.mount();

    const workNode = capturedElements(capture).find((el) => el.group === 'nodes' && el.data?.id === 'work');
    assert.ok(workNode !== undefined, 'the self-loop node must be present in the element set');
    assert.ok(workNode.position !== undefined, 'the self-loop node must carry a position');

    const selfLoop = capturedElements(capture).find((el) => el.group === 'edges' && el.data?.id === 'work__retry__work');
    assert.ok(selfLoop !== undefined, 'the self-loop edge must be present');
    assert.equal(capture.batchCalls, 2, 'visibility sweep runs even with a self-loop present');
  });
});

void describe('CompositeLayout.compute', () => {
  void it('linear DAG: A→B→C positions form a top-down sequence (A smallest y)', async () => {
    const dag = TestDag.of('linear', 'A', [
      singleNode('A', { "next": 'B' }),
      singleNode('B', { "next": 'C' }),
      singleNode('C', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
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
    const innerA = TestDag.of('innerA', 'a1', [
      singleNode('a1', { "go": 'a2' }),
      singleNode('a2', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);
    const innerB = TestDag.of('innerB', 'b1', [
      singleNode('b1', { "go": 'b2' }),
      singleNode('b2', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);

    // outer DAG: embedA then embedB in sequence
    const outerDAG: DAGType = TestDag.of('outer2', 'embedA', [
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
      { '@id': 'urn:noocodex:dag:outer2/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);

    const embeddedDAGs = new Map<string, DAGType>([['innerA', innerA], ['innerB', innerB]]);
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
    const innerDAG = TestDag.of('inner', 'entry-node', [
      singleNode('entry-node',  { "go": 'middle-node' }),
      singleNode('middle-node', { "go": 'exit-node' }),
      singleNode('exit-node',   { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);

    // outer DAG: before → ScatterNode(body.dag=inner) → after
    const outerDAG: DAGType = TestDag.of('outer', 'before', [
      singleNode('before', { "go": 'embed' }),
      {
        '@id':    'urn:noocodex:dag:outer/node/embed',
        '@type':  'EmbeddedDAGNode',
        'name':   'embed',
        'dag':    'inner',
        'outputs': { "done": 'after' },
      },
      singleNode('after', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:outer/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAGType['nodes'][0],
    ]);

    const embeddedDAGs = new Map<string, DAGType>([['inner', innerDAG]]);
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
