/**
 * reservoir-viz.test.ts: assertions for the reservoir glyph in MermaidRenderer
 * and CytoscapeRenderer.
 *
 * Guards:
 *   - Reservoir-configured ScatterNode → reservoir marking in Mermaid output
 *     (augmented label, classDef reservoir, class assignment).
 *   - Reservoir-configured ScatterNode → dag-reservoir class and reservoir
 *     data field in Cytoscape output.
 *   - Parity guard: plain (non-reservoir) ScatterNode renders identically to
 *     pre-sub-wave-6 behavior in both renderers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DAG } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { CytoscapeRenderer } from '../../src/viz/CytoscapeRenderer.js';
import type { CytoscapeNodeElement } from '../../src/viz/CytoscapeRenderer.js';
import { MermaidRenderer } from '../../src/viz/MermaidRenderer.js';

const isNode = (el: { group: 'nodes' | 'edges' }): el is CytoscapeNodeElement =>
  el.group === 'nodes';

// ── Shared DAG fixtures ────────────────────────────────────────────────────────

/** ScatterNode with a reservoir config (keyField + capacity + idleMs). */
const RESERVOIR_DAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:reservoir',
  '@type':    'DAG',
  'name':       'reservoir',
  'version':    '1',
  'entrypoint': 'buffer',
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir/node/buffer',
      '@type':    'ScatterNode',
      'name':     'buffer',
      'body':     { 'node': 'worker' },
      'source':   'events',
      'gather':   { 'strategy': 'discard' },
      'reservoir': { 'keyField': 'tenantId', 'capacity': 50, 'idleMs': 5000 },
      'outputs':  { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
    { '@id': 'urn:noocodex:dag:reservoir/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

/** ScatterNode with reservoir but no idleMs (capacity-only flush). */
const RESERVOIR_NO_IDLEMS_DAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:reservoir-no-idle',
  '@type':    'DAG',
  'name':       'reservoir-no-idle',
  'version':    '1',
  'entrypoint': 'batch',
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir-no-idle/node/batch',
      '@type':    'ScatterNode',
      'name':     'batch',
      'body':     { 'node': 'processor' },
      'source':   'records',
      'gather':   { 'strategy': 'discard' },
      'reservoir': { 'keyField': 'region', 'capacity': 100 },
      'outputs':  { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
    { '@id': 'urn:noocodex:dag:reservoir-no-idle/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

/** Plain ScatterNode — no reservoir field. Parity guard fixture. */
const PLAIN_SCATTER_DAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:plain-scatter',
  '@type':    'DAG',
  'name':       'plain-scatter',
  'version':    '1',
  'entrypoint': 'fan',
  'nodes': [
    {
      '@id':    'urn:noocodex:dag:plain-scatter/node/fan',
      '@type':  'ScatterNode',
      'name':   'fan',
      'body':   { 'node': 'worker' },
      'source': 'items',
      'gather': { 'strategy': 'discard' },
      'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    },
    { '@id': 'urn:noocodex:dag:plain-scatter/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

// ── MermaidRenderer ────────────────────────────────────────────────────────────

void describe('MermaidRenderer: reservoir glyph', () => {
  void it('reservoir-configured scatter carries keyField×capacity in the label', () => {
    const out = MermaidRenderer.render(RESERVOIR_DAG);
    // Label must contain the reservoir indicator with keyField and capacity.
    assert.match(out, /▣ tenantId ×50/u);
  });

  void it('reservoir-configured scatter uses trapezoid shape', () => {
    const out = MermaidRenderer.render(RESERVOIR_DAG);
    // Shape is still [/.../] (trapezoid) — only the label content changes.
    assert.match(out, /buffer\[\/.*▣.*\/\]/u);
  });

  void it('emits a classDef reservoir rule when a reservoir scatter is present', () => {
    const out = MermaidRenderer.render(RESERVOIR_DAG);
    assert.match(out, /classDef reservoir fill:/u);
    // Fill color must be the chosen reservoir blue.
    assert.match(out, /classDef reservoir fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe/u);
  });

  void it('assigns the reservoir class to the reservoir-configured node', () => {
    const out = MermaidRenderer.render(RESERVOIR_DAG);
    assert.match(out, /class buffer reservoir/u);
  });

  void it('reservoir config without idleMs still emits the reservoir marking', () => {
    const out = MermaidRenderer.render(RESERVOIR_NO_IDLEMS_DAG);
    assert.match(out, /▣ region ×100/u);
    assert.match(out, /classDef reservoir fill:/u);
    assert.match(out, /class batch reservoir/u);
  });

  void it('emits the classDef only ONCE when a single reservoir scatter is present', () => {
    const out = MermaidRenderer.render(RESERVOIR_DAG);
    const matches = out.match(/classDef reservoir/gu);
    assert.equal(matches?.length ?? 0, 1, 'exactly one classDef reservoir line');
  });

  // ── Parity guard ──────────────────────────────────────────────────────────

  void it('plain (non-reservoir) scatter renders as a bare trapezoid — no reservoir marking', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG);
    // Shape is plain [/label/] without any augmentation.
    assert.match(out, /fan\[\/fan\/\]/u);
    // No reservoir indicator in the label.
    assert.doesNotMatch(out, /▣/u);
  });

  void it('plain scatter has no classDef reservoir', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG);
    assert.doesNotMatch(out, /classDef reservoir/u);
  });

  void it('plain scatter has no class reservoir assignment', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG);
    assert.doesNotMatch(out, /class fan reservoir/u);
  });
});

// ── CytoscapeRenderer ──────────────────────────────────────────────────────────

void describe('CytoscapeRenderer: reservoir glyph', () => {
  void it('reservoir-configured scatter carries the dag-reservoir class', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_DAG, {});
    const bufferNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'buffer',
    );
    assert.ok(bufferNode !== undefined, 'buffer node must be present');
    assert.ok(
      bufferNode.classes.includes('dag-reservoir'),
      `expected dag-reservoir in classes "${bufferNode.classes}"`,
    );
  });

  void it('reservoir-configured scatter still carries the dag-scatter class', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_DAG, {});
    const bufferNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'buffer',
    );
    assert.ok(bufferNode !== undefined);
    assert.ok(
      bufferNode.classes.includes('dag-scatter'),
      `expected dag-scatter in classes "${bufferNode.classes}"`,
    );
  });

  void it('reservoir-configured scatter carries a reservoir data field with correct keyField and capacity', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_DAG, {});
    const bufferNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'buffer',
    );
    assert.ok(bufferNode !== undefined);
    const res = bufferNode.data['reservoir'];
    assert.ok(res !== undefined, 'reservoir data field must be present');
    assert.equal(res.keyField, 'tenantId');
    assert.equal(res.capacity, 50);
    assert.equal(res.idleMs, 5000);
  });

  void it('reservoir data field without idleMs has idleMs undefined', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_NO_IDLEMS_DAG, {});
    const batchNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'batch',
    );
    assert.ok(batchNode !== undefined, 'batch node must be present');
    const res = batchNode.data['reservoir'];
    assert.ok(res !== undefined, 'reservoir data field must be present');
    assert.equal(res.keyField, 'region');
    assert.equal(res.capacity, 100);
    assert.equal(res.idleMs, undefined);
  });

  void it('reservoir-configured scatter has data.type === scatter', () => {
    const elements = CytoscapeRenderer.render(RESERVOIR_DAG, {});
    const bufferNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'buffer',
    );
    assert.ok(bufferNode !== undefined);
    assert.equal(bufferNode.data.type, 'scatter');
  });

  // ── Parity guard ──────────────────────────────────────────────────────────

  void it('plain (non-reservoir) scatter has NO dag-reservoir class', () => {
    const elements = CytoscapeRenderer.render(PLAIN_SCATTER_DAG, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined, 'fan node must be present');
    assert.ok(
      !fanNode.classes.includes('dag-reservoir'),
      `dag-reservoir must not be in classes "${fanNode.classes}"`,
    );
  });

  void it('plain scatter has NO reservoir data field', () => {
    const elements = CytoscapeRenderer.render(PLAIN_SCATTER_DAG, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined);
    assert.equal(fanNode.data['reservoir'], undefined);
  });

  void it('plain scatter classes are exactly dag-scatter (unchanged)', () => {
    const elements = CytoscapeRenderer.render(PLAIN_SCATTER_DAG, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined);
    assert.equal(fanNode.classes, 'dag-scatter');
  });

  void it('plain scatter data.type is still scatter', () => {
    const elements = CytoscapeRenderer.render(PLAIN_SCATTER_DAG, {});
    const fanNode = elements.find(
      (el): el is CytoscapeNodeElement => isNode(el) && el.data.id === 'fan',
    );
    assert.ok(fanNode !== undefined);
    assert.equal(fanNode.data.type, 'scatter');
  });
});
