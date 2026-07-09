import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type cytoscape from 'cytoscape';

import type { DAGType } from '../../src/entities/index.js';
import { CompositeLayout } from '../../src/viz/CompositeLayout.js';
import { CytoscapeGraph } from '../../src/viz/CytoscapeGraph.js';
import { TestDag } from '../_support/TestDag.js';

const LINEAR_DAG_IRI = 'urn:noocodec:dag:linear';
const MINI_DAG_IRI = 'urn:noocodec:dag:mini';
const RETRY_DAG_IRI = 'urn:noocodec:dag:retry';
const INNER_A_DAG_IRI = 'urn:noocodec:dag:innerA';
const INNER_B_DAG_IRI = 'urn:noocodec:dag:innerB';
const OUTER_TWO_DAG_IRI = 'urn:noocodec:dag:outer2';
const INNER_DAG_IRI = 'urn:noocodec:dag:inner';
const OUTER_DAG_IRI = 'urn:noocodec:dag:outer';

const placementIri = TestDag.placementIri;
const scopedPlacementIri = (parentIri: string, dagIri: string, placement: string): string => `${parentIri}/${placementIri(dagIri, placement)}`;

// ── Local type-narrowing helpers ─────────────────────────────────────────────

class CytoscapeGuard {
  private constructor() {}

  /** Narrows an unknown value to cytoscape.Core — checks the two methods CytoscapeGraph calls. */
  static isCore(v: unknown): v is cytoscape.Core {
    return typeof v === 'object' && v !== null && 'batch' in v && 'nodes' in v;
  }

  /** Narrows an unknown object to cytoscape's container type (HTMLElement at runtime). */
  static isContainer(v: unknown): v is NonNullable<cytoscape.CytoscapeOptions['container']> {
    return typeof v === 'object' && v !== null;
  }

  /** Narrows an unknown value to a cytoscape element descriptor used in the graph config. */
  static isElementEntry(v: unknown): v is { group?: string; data?: { id?: string }; position?: { x: number; y: number } } {
    return typeof v === 'object' && v !== null;
  }

  /** Narrows an unknown value to a cytoscape stylesheet rule descriptor. */
  static isStyleEntry(v: unknown): v is { selector?: string; style?: Record<string, unknown> } {
    return typeof v === 'object' && v !== null;
  }
}

const rawContainer: unknown = {};
if (!CytoscapeGuard.isContainer(rawContainer)) throw new Error('fakeContainer setup failed');
/** A plain object passed as container; the overridden construct() ignores options so it is never used as HTMLElement. */
const fakeContainer = rawContainer;

// ── Helpers ──────────────────────────────────────────────────────────────

class PlacementFixture {
  private constructor() {}

  static single(dagIri: string, name: string, outputs: Record<string, string>): DAGType['nodes'][0] {
    return {
      '@id': placementIri(dagIri, name),
      '@type':  'SingleNode',
      'name':   name,
      'node':   name,
      'outputs': outputs,
    };
  }
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
    const raw = {
      "batch": (fn: () => void): void => { capture.batchCalls += 1; fn(); },
      "nodes": (): typeof fakeNodes => fakeNodes,
    };
    // Verify the minimal Core surface CytoscapeGraph calls is present before resolving.
    if (!CytoscapeGuard.isCore(raw)) throw new Error('fakeCore does not satisfy cytoscape.Core interface');
    return Promise.resolve(raw);
  }
}

class CaptureReader {
  private constructor() {}

  /** Read the elements array passed to the stub factory as plain records. */
  static elements(capture: Capture): Array<{ group?: string; data?: { id?: string }; position?: { x: number; y: number } }> {
    const els = capture.config?.elements;
    if (!Array.isArray(els)) return [];
    const result: Array<{ group?: string; data?: { id?: string }; position?: { x: number; y: number } }> = [];
    for (const e of els) {
      if (CytoscapeGuard.isElementEntry(e)) result.push(e);
    }
    return result;
  }

  /** Read the stylesheet array passed to the stub factory as plain records. */
  static style(capture: Capture): Array<{ selector?: string; style?: Record<string, unknown> }> {
    const style = capture.config?.style;
    if (!Array.isArray(style)) return [];
    const result: Array<{ selector?: string; style?: Record<string, unknown> }> = [];
    for (const s of style) {
      if (CytoscapeGuard.isStyleEntry(s)) result.push(s);
    }
    return result;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

void describe('CytoscapeGraph.mount', () => {
  void it('mounts: resolves the Core, sets .cy, and invokes onReady', async () => {
    const dag = TestDag.of(LINEAR_DAG_IRI, placementIri(LINEAR_DAG_IRI, 'A'), [
      PlacementFixture.single(LINEAR_DAG_IRI, 'A', { "next": placementIri(LINEAR_DAG_IRI, 'B') }),
      PlacementFixture.single(LINEAR_DAG_IRI, 'B', { "next": placementIri(LINEAR_DAG_IRI, 'C') }),
      PlacementFixture.single(LINEAR_DAG_IRI, 'C', { "done": placementIri(LINEAR_DAG_IRI, 'end') }),
      { '@id': placementIri(LINEAR_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
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
    const dag = TestDag.of(LINEAR_DAG_IRI, placementIri(LINEAR_DAG_IRI, 'A'), [
      PlacementFixture.single(LINEAR_DAG_IRI, 'A', { "next": placementIri(LINEAR_DAG_IRI, 'B') }),
      PlacementFixture.single(LINEAR_DAG_IRI, 'B', { "next": placementIri(LINEAR_DAG_IRI, 'C') }),
      PlacementFixture.single(LINEAR_DAG_IRI, 'C', { "done": placementIri(LINEAR_DAG_IRI, 'end') }),
      { '@id': placementIri(LINEAR_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new StubCytoscapeGraph(capture, fakeContainer, dag);
    await graph.mount();

    const nodes = CaptureReader.elements(capture).filter((el) => el.group === 'nodes');
    assert.ok(nodes.length >= 3, 'at least A, B, C must be present');
    for (const node of nodes) {
      assert.ok(node.position !== undefined, `node ${node.data?.id} must have a position`);
      assert.ok(Number.isFinite(node.position?.x), `node ${node.data?.id} x must be finite`);
      assert.ok(Number.isFinite(node.position?.y), `node ${node.data?.id} y must be finite`);
    }
  });

  void it('stylesheet uses explicit numeric node sizing — never the string "label"', async () => {
    const dag = TestDag.of(MINI_DAG_IRI, placementIri(MINI_DAG_IRI, 'A'), [
      PlacementFixture.single(MINI_DAG_IRI, 'A', { "done": placementIri(MINI_DAG_IRI, 'end') }),
      { '@id': placementIri(MINI_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);
    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new StubCytoscapeGraph(capture, fakeContainer, dag);
    await graph.mount();

    const style = CaptureReader.style(capture);
    const nodeBase = style.find((rule) => rule.selector === 'node');
    assert.ok(nodeBase !== undefined, 'a base "node" selector must exist');
    assert.equal(typeof nodeBase.style?.['width'], 'number', 'node width must be numeric');
    assert.equal(typeof nodeBase.style?.['height'], 'number', 'node height must be numeric');

    // Regression guard: label auto-sizing makes self-loop nodes invisible.
    for (const rule of style) {
      assert.notEqual(rule.style?.['width'], 'label', `${rule.selector} width must not be 'label'`);
      assert.notEqual(rule.style?.['height'], 'label', `${rule.selector} height must not be 'label'`);
    }
  });

  void it('self-loop (retry-to-self) node still renders and enforceVisibility does not throw', async () => {
    // 'retry' route targets the node itself → a cytoscape self-loop edge.
    const dag = TestDag.of(RETRY_DAG_IRI, placementIri(RETRY_DAG_IRI, 'work'), [
      PlacementFixture.single(RETRY_DAG_IRI, 'work', { "success": placementIri(RETRY_DAG_IRI, 'end'), "retry": placementIri(RETRY_DAG_IRI, 'work') }),
      { '@id': placementIri(RETRY_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new StubCytoscapeGraph(capture, fakeContainer, dag);
    await graph.mount();

    const workNode = CaptureReader.elements(capture).find((el) => el.group === 'nodes' && el.data?.id === placementIri(RETRY_DAG_IRI, 'work'));
    assert.ok(workNode !== undefined, 'the self-loop node must be present in the element set');
    assert.ok(workNode.position !== undefined, 'the self-loop node must carry a position');

    const selfLoop = CaptureReader.elements(capture).find((el) => el.group === 'edges' && el.data?.id === `${placementIri(RETRY_DAG_IRI, 'work')}__retry__${placementIri(RETRY_DAG_IRI, 'work')}`);
    assert.ok(selfLoop !== undefined, 'the self-loop edge must be present');
    assert.equal(capture.batchCalls, 2, 'visibility sweep runs even with a self-loop present');
  });
});

void describe('CompositeLayout.compute', () => {
  void it('linear DAG: A→B→C positions form a top-down sequence (A smallest y)', async () => {
    const dag = TestDag.of(LINEAR_DAG_IRI, placementIri(LINEAR_DAG_IRI, 'A'), [
      PlacementFixture.single(LINEAR_DAG_IRI, 'A', { "next": placementIri(LINEAR_DAG_IRI, 'B') }),
      PlacementFixture.single(LINEAR_DAG_IRI, 'B', { "next": placementIri(LINEAR_DAG_IRI, 'C') }),
      PlacementFixture.single(LINEAR_DAG_IRI, 'C', { "done": placementIri(LINEAR_DAG_IRI, 'end') }),
      { '@id': placementIri(LINEAR_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);

    const { positions } = await CompositeLayout.compute(dag);

    const posA = positions.get(placementIri(LINEAR_DAG_IRI, 'A'));
    const posB = positions.get(placementIri(LINEAR_DAG_IRI, 'B'));
    const posC = positions.get(placementIri(LINEAR_DAG_IRI, 'C'));

    assert.ok(posA !== undefined, 'A must have a position');
    assert.ok(posB !== undefined, 'B must have a position');
    assert.ok(posC !== undefined, 'C must have a position');

    assert.ok(posA.y < posB.y, `A.y (${posA.y}) must be < B.y (${posB.y})`);
    assert.ok(posB.y < posC.y, `B.y (${posB.y}) must be < C.y (${posC.y})`);
  });

  void it('2-level nesting: sibling compounds do not overlap each other', async () => {
    // inner DAGs: each has two leaf nodes
    const innerA = TestDag.of(INNER_A_DAG_IRI, placementIri(INNER_A_DAG_IRI, 'a1'), [
      PlacementFixture.single(INNER_A_DAG_IRI, 'a1', { "go": placementIri(INNER_A_DAG_IRI, 'a2') }),
      PlacementFixture.single(INNER_A_DAG_IRI, 'a2', { "done": placementIri(INNER_A_DAG_IRI, 'end') }),
      { '@id': placementIri(INNER_A_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);
    const innerB = TestDag.of(INNER_B_DAG_IRI, placementIri(INNER_B_DAG_IRI, 'b1'), [
      PlacementFixture.single(INNER_B_DAG_IRI, 'b1', { "go": placementIri(INNER_B_DAG_IRI, 'b2') }),
      PlacementFixture.single(INNER_B_DAG_IRI, 'b2', { "done": placementIri(INNER_B_DAG_IRI, 'end') }),
      { '@id': placementIri(INNER_B_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);

    // outer DAG: embedA then embedB in sequence
    const outerDAG: DAGType = TestDag.of(OUTER_TWO_DAG_IRI, placementIri(OUTER_TWO_DAG_IRI, 'embedA'), [
      {
        '@id': placementIri(OUTER_TWO_DAG_IRI, 'embedA'),
        '@type':  'EmbeddedDAGNode',
        'name':   'embedA',
        'dag':    INNER_A_DAG_IRI,
        'outputs': { "done": placementIri(OUTER_TWO_DAG_IRI, 'embedB') },
      },
      {
        '@id': placementIri(OUTER_TWO_DAG_IRI, 'embedB'),
        '@type':  'EmbeddedDAGNode',
        'name':   'embedB',
        'dag':    INNER_B_DAG_IRI,
        'outputs': { "done": placementIri(OUTER_TWO_DAG_IRI, 'end'), "error": placementIri(OUTER_TWO_DAG_IRI, 'end') },
      },
      { '@id': placementIri(OUTER_TWO_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);

    const embeddedDAGs = new Map<string, DAGType>([[INNER_A_DAG_IRI, innerA], [INNER_B_DAG_IRI, innerB]]);
    const { positions } = await CompositeLayout.compute(outerDAG, embeddedDAGs);

    // embedA compound center
    const posEmbedA = positions.get(placementIri(OUTER_TWO_DAG_IRI, 'embedA'));
    // embedB compound center
    const posEmbedB = positions.get(placementIri(OUTER_TWO_DAG_IRI, 'embedB'));
    // children of embedA
    const posA1 = positions.get(scopedPlacementIri(placementIri(OUTER_TWO_DAG_IRI, 'embedA'), INNER_A_DAG_IRI, 'a1'));
    const posA2 = positions.get(scopedPlacementIri(placementIri(OUTER_TWO_DAG_IRI, 'embedA'), INNER_A_DAG_IRI, 'a2'));
    // children of embedB
    const posB1 = positions.get(scopedPlacementIri(placementIri(OUTER_TWO_DAG_IRI, 'embedB'), INNER_B_DAG_IRI, 'b1'));
    const posB2 = positions.get(scopedPlacementIri(placementIri(OUTER_TWO_DAG_IRI, 'embedB'), INNER_B_DAG_IRI, 'b2'));

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
    const innerDAG = TestDag.of(INNER_DAG_IRI, placementIri(INNER_DAG_IRI, 'entry-node'), [
      PlacementFixture.single(INNER_DAG_IRI, 'entry-node',  { "go": placementIri(INNER_DAG_IRI, 'middle-node') }),
      PlacementFixture.single(INNER_DAG_IRI, 'middle-node', { "go": placementIri(INNER_DAG_IRI, 'exit-node') }),
      PlacementFixture.single(INNER_DAG_IRI, 'exit-node',   { "done": placementIri(INNER_DAG_IRI, 'end') }),
      { '@id': placementIri(INNER_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);

    // outer DAG: before → ScatterNode(body.dag=inner) → after
    const outerDAG: DAGType = TestDag.of(OUTER_DAG_IRI, placementIri(OUTER_DAG_IRI, 'before'), [
      PlacementFixture.single(OUTER_DAG_IRI, 'before', { "go": placementIri(OUTER_DAG_IRI, 'embed') }),
      {
        '@id': placementIri(OUTER_DAG_IRI, 'embed'),
        '@type':  'EmbeddedDAGNode',
        'name':   'embed',
        'dag':    INNER_DAG_IRI,
        'outputs': { "done": placementIri(OUTER_DAG_IRI, 'after') },
      },
      PlacementFixture.single(OUTER_DAG_IRI, 'after', { "done": placementIri(OUTER_DAG_IRI, 'end') }),
      { '@id': placementIri(OUTER_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } satisfies DAGType['nodes'][number],
    ]);

    const embeddedDAGs = new Map<string, DAGType>([[INNER_DAG_IRI, innerDAG]]);
    const { positions } = await CompositeLayout.compute(outerDAG, embeddedDAGs);

    const posBefore  = positions.get(placementIri(OUTER_DAG_IRI, 'before'));
    const posEmbed   = positions.get(placementIri(OUTER_DAG_IRI, 'embed'));
    const posAfter   = positions.get(placementIri(OUTER_DAG_IRI, 'after'));
    const posEntry   = positions.get(scopedPlacementIri(placementIri(OUTER_DAG_IRI, 'embed'), INNER_DAG_IRI, 'entry-node'));
    const posMiddle  = positions.get(scopedPlacementIri(placementIri(OUTER_DAG_IRI, 'embed'), INNER_DAG_IRI, 'middle-node'));
    const posExit    = positions.get(scopedPlacementIri(placementIri(OUTER_DAG_IRI, 'embed'), INNER_DAG_IRI, 'exit-node'));

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
