import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type cytoscape from 'cytoscape';

import { DAG_CONTEXT } from '../../src/entities/index.js';
import type { DAG } from '../../src/entities/index.js';
import { CytoscapeGraph } from '../../src/viz/CytoscapeGraph.js';

// ── Helpers ──────────────────────────────────────────────────────────────

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
    '@context':   DAG_CONTEXT,
    '@id':        `urn:noocodex:dag:${name}`,
    '@type':      'DAG',
    'name':       name,
    'version':    '1',
    'entrypoint': entrypoint,
    'nodes':      nodes,
  };
}

/** A captured cytoscape config plus a record of fake-Core method calls. */
interface Capture {
  config: cytoscape.CytoscapeOptions | null;
  batchCalls: number;
}

/**
 * Build a stub cytoscape factory that records the config it is given and
 * returns a minimal fake `Core` implementing only what `CytoscapeGraph` calls
 * (`batch` + `nodes().style`). Real cytoscape needs a DOM/canvas, which is not
 * available under `node --test`; the stub exercises the assembly path without it.
 */
function stubFactory(capture: Capture): typeof cytoscape {
  const fakeNodes = { "style": (): void => { /* no-op */ } };
  const fakeCore = {
    "batch": (fn: () => void): void => { capture.batchCalls += 1; fn(); },
    "nodes": (): typeof fakeNodes => fakeNodes,
  };
  const factory = (config: cytoscape.CytoscapeOptions): cytoscape.Core => {
    capture.config = config;
    // Constructs intentionally-invalid input: fakeCore omits the full cytoscape.Core surface;
    // only the methods called by CytoscapeGraph (batch + nodes) are implemented.
    return fakeCore as unknown as cytoscape.Core;
  };
  // Constructs intentionally-invalid input: the factory function signature narrows to
  // typeof cytoscape (DOM factory) for injection without a real DOM environment.
  return factory as unknown as typeof cytoscape;
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
    const dag = makeDAG('linear', 'A', [
      singleNode('A', { "next": 'B' }),
      singleNode('B', { "next": 'C' }),
      singleNode('C', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    let onReadyCalls = 0;

    class RecordingGraph extends CytoscapeGraph {
      protected override onReady(): void { onReadyCalls += 1; }
    }

    const graph = new RecordingGraph(stubFactory(capture), fakeContainer, dag);
    const cy = await graph.mount();

    assert.ok(cy !== null, 'mount must return a Core');
    assert.equal(graph.cy, cy, '.cy must be the mounted Core');
    assert.equal(onReadyCalls, 1, 'onReady must be called exactly once');
    assert.equal(capture.batchCalls, 2, 'enforceVisibility must run two batches');
  });

  void it('applies pre-computed positions to every node element', async () => {
    const dag = makeDAG('linear', 'A', [
      singleNode('A', { "next": 'B' }),
      singleNode('B', { "next": 'C' }),
      singleNode('C', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new CytoscapeGraph(stubFactory(capture), fakeContainer, dag);
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
    const dag = makeDAG('mini', 'A', [
      singleNode('A', { "done": 'end' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);
    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new CytoscapeGraph(stubFactory(capture), fakeContainer, dag);
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
    const dag = makeDAG('retry', 'work', [
      singleNode('work', { "success": 'end', "retry": 'work' }),
      { '@id': 'urn:noocodex:dag:test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' } as DAG['nodes'][0],
    ]);

    const capture: Capture = { "config": null, "batchCalls": 0 };
    const graph = new CytoscapeGraph(stubFactory(capture), fakeContainer, dag);
    await graph.mount();

    const workNode = capturedElements(capture).find((el) => el.group === 'nodes' && el.data?.id === 'work');
    assert.ok(workNode !== undefined, 'the self-loop node must be present in the element set');
    assert.ok(workNode.position !== undefined, 'the self-loop node must carry a position');

    const selfLoop = capturedElements(capture).find((el) => el.group === 'edges' && el.data?.id === 'work__retry__work');
    assert.ok(selfLoop !== undefined, 'the self-loop edge must be present');
    assert.equal(capture.batchCalls, 2, 'visibility sweep runs even with a self-loop present');
  });
});
