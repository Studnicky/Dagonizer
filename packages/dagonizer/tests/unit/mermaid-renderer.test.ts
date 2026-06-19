import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TerminalNodeType } from '../../src/entities/dag/TerminalNode.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAG_CONTEXT } from '../../src/entities/index.js';
import { RoleColorUtils } from '../../src/viz/internal.js';
import { MermaidRenderer } from '../../src/viz/MermaidRenderer.js';

void describe('MermaidRenderer.render', () => {
  void it('renders a single-node DAG with terminal', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:mini',
      '@type':    'DAG',
      'name':       'mini',
      'version':    '1',
      'entrypoint': 'greet',
      'nodes': [{
        '@id':    'urn:noocodex:dag:mini/node/greet',
        '@type':  'SingleNode',
        'name':   'greet',
        'node':   'greet',
        'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:mini/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    assert.match(out, /flowchart LR/u);
    assert.match(out, /greet\[greet\]/u);
    assert.match(out, /greet -->\|success\| end/u);
    assert.match(out, /end\(\(\(end/u);
  });

  void it('renders a ScatterNode as a trapezoid', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name':       'fan',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [{
        '@id':    'urn:noocodex:dag:fan/node/fan',
        '@type':  'ScatterNode',
        'name':   'fan',
        'body':   { 'node': 'worker' },
        'source': 'items',
        'gather': { 'strategy': 'partition', 'partitions': { 'success': 'collected', 'error': 'errors' } },
        'outputs': { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
      },
        { '@id': 'urn:noocodex:dag:fan/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    // ScatterNode renders as trapezoid: name[/label/]
    assert.match(out, /fan\[\/fan\/\]/u);
    assert.match(out, /fan -->\|all-success\| end/u);
  });

  void it('renders an EmbeddedDAGNode as a subroutine', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:deep',
      '@type':    'DAG',
      'name':       'deep',
      'version':    '1',
      'entrypoint': 'enrich',
      'nodes': [{
        '@id':  'urn:noocodex:dag:deep/node/enrich',
        '@type': 'EmbeddedDAGNode',
        'name':  'enrich',
        'dag':   'inner',
        'outputs': { 'success': 'next', 'error': 'next' },
      },
        { '@id': 'urn:noocodex:dag:deep/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    // EmbeddedDAGNode renders as a subroutine shape: name[[label]]
    assert.match(out, /enrich\[\[enrich\]\]/u);
  });
});

void describe('MermaidRenderer.render: PhaseNode', () => {
  void it('renders a pre-phase PhaseNode as a stadium shape and emits no outgoing edges', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ph',
      '@type':    'DAG',
      'name':       'ph',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ph/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':   'urn:noocodex:dag:ph/node/setup',
          '@type': 'PhaseNode',
          'name':  'setup',
          'node':  'setup-worker',
          'phase': 'pre',
        },
        { '@id': 'urn:noocodex:dag:ph/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    // stadium shape: name([label (phase)])
    assert.match(out, /setup\(\[setup \(pre\)\]\)/u);
    // PhaseNode emits no outgoing edges
    const edgeLines = out.split('\n').filter((line) => line.includes('-->') && line.includes('setup'));
    assert.equal(edgeLines.length, 0);
    // does not crash; returns valid flowchart
    assert.match(out, /flowchart LR/u);
  });

  void it('renders a post-phase PhaseNode with phase suffix in label', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ph2',
      '@type':    'DAG',
      'name':       'ph2',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:ph2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':   'urn:noocodex:dag:ph2/node/teardown',
          '@type': 'PhaseNode',
          'name':  'teardown',
          'node':  'teardown-worker',
          'phase': 'post',
        },
        { '@id': 'urn:noocodex:dag:ph2/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    assert.match(out, /teardown\(\[teardown \(post\)\]\)/u);
  });
});

void describe('MermaidRenderer.render: containment coloring', () => {
  void it('emits per-role classDef and class assignment for a contained EmbeddedDAGNode', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:worker-test',
      '@type':    'DAG',
      'name':       'worker-test',
      'version':    '1',
      'entrypoint': 'in-process',
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:worker-test/node/in-process',
          '@type':     'SingleNode',
          'name':      'in-process',
          'node':      'noop',
          'outputs':   { 'success': 'worker-dag' },
        },
        {
          '@id':       'urn:noocodex:dag:worker-test/node/worker-dag',
          '@type':     'EmbeddedDAGNode',
          'name':      'worker-dag',
          'dag':       'cpu-dag',
          'container': 'cpu',
          'outputs':   { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:worker-test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    // Per-role classDef must be present for role 'cpu'
    assert.match(out, /classDef contained-cpu fill:/u);
    // The fill must match RoleColorUtils.forRole('cpu')
    const cpuColors = RoleColorUtils.forRole('cpu');
    assert.match(out, new RegExp(`classDef contained-cpu fill:${cpuColors.fill}`, 'u'));
    // class assignment for the contained node uses the per-role class
    assert.match(out, /class worker-dag contained-cpu/u);
    // in-process node does NOT get any class
    assert.doesNotMatch(out, /class in-process contained/u);
    // shape is preserved: EmbeddedDAGNode stays subroutine [[...]]
    assert.match(out, /worker-dag\[\[worker-dag\]\]/u);
  });

  void it('emits per-role classDef and class assignment for a contained dag-body ScatterNode', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-worker',
      '@type':    'DAG',
      'name':       'scatter-worker',
      'version':    '1',
      'entrypoint': 'fan',
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:scatter-worker/node/fan',
          '@type':     'ScatterNode',
          'name':      'fan',
          'body':      { 'dag': 'item-dag' },
          'source':    'items',
          'gather':    { 'strategy': 'discard' },
          'container': 'cpu',
          'outputs':   { 'success': 'end' },
        },
        {
          '@id':     'urn:noocodex:dag:scatter-worker/node/plain',
          '@type':   'SingleNode',
          'name':    'plain',
          'node':    'noop',
          'outputs': { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:scatter-worker/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    assert.match(out, /classDef contained-cpu fill:/u);
    assert.match(out, /class fan contained-cpu/u);
    // ScatterNode shape is preserved: trapezoid [/.../]
    assert.match(out, /fan\[\/fan\/\]/u);
    // in-process node does NOT get the class
    assert.doesNotMatch(out, /class plain contained/u);
  });

  void it('emits NO classDef when no placement has a container role', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:no-container',
      '@type':    'DAG',
      'name':       'no-container',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [{
        '@id':     'urn:noocodex:dag:no-container/node/step',
        '@type':   'SingleNode',
        'name':    'step',
        'node':    'noop',
        'outputs': { 'success': 'end' },
      },
        { '@id': 'urn:noocodex:dag:no-container/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    assert.doesNotMatch(out, /classDef contained/u);
    assert.doesNotMatch(out, /class step contained/u);
  });

  void it('emits TWO distinct classDefs for a DAG with two distinct container roles', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:multi-role',
      '@type':    'DAG',
      'name':     'multi-role',
      'version':  '1',
      'entrypoint': 'cpu-work',
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:multi-role/node/cpu-work',
          '@type':     'ScatterNode',
          'name':      'cpu-work',
          'body':      { 'dag': 'item-dag' },
          'source':    'tasks',
          'gather':    { 'strategy': 'discard' },
          'container': 'cpu',
          'outputs':   { 'all-success': 'io-work', 'partial': 'io-work', 'all-error': 'end', 'empty': 'end' },
        },
        {
          '@id':       'urn:noocodex:dag:multi-role/node/io-work',
          '@type':     'EmbeddedDAGNode',
          'name':      'io-work',
          'dag':       'io-dag',
          'container': 'io',
          'outputs':   { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:multi-role/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);

    const cpuColors = RoleColorUtils.forRole('cpu');
    const ioColors  = RoleColorUtils.forRole('io');

    // Two distinct classDef lines
    assert.match(out, /classDef contained-cpu fill:/u);
    assert.match(out, /classDef contained-io fill:/u);
    // Each uses the correct per-role fill
    assert.match(out, new RegExp(`classDef contained-cpu fill:${cpuColors.fill}`, 'u'));
    assert.match(out, new RegExp(`classDef contained-io fill:${ioColors.fill}`, 'u'));
    // The two fills must be different (roles are distinct in the palette)
    assert.notEqual(cpuColors.fill, ioColors.fill);
    // Class assignments are role-specific
    assert.match(out, /class cpu-work contained-cpu/u);
    assert.match(out, /class io-work contained-io/u);
    // Shapes are preserved
    assert.match(out, /cpu-work\[\/cpu-work\/\]/u);
    assert.match(out, /io-work\[\[io-work\]\]/u);
  });

  void it('assigns the SAME class to two placements with the SAME role (grouping)', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:same-role',
      '@type':    'DAG',
      'name':     'same-role',
      'version':  '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:same-role/node/a',
          '@type':     'EmbeddedDAGNode',
          'name':      'a',
          'dag':       'inner-a',
          'container': 'cpu',
          'outputs':   { 'success': 'b' },
        },
        {
          '@id':       'urn:noocodex:dag:same-role/node/b',
          '@type':     'EmbeddedDAGNode',
          'name':      'b',
          'dag':       'inner-b',
          'container': 'cpu',
          'outputs':   { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:same-role/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    const out = MermaidRenderer.render(dag);
    // Only ONE classDef for role cpu
    const classDefMatches = out.match(/classDef contained-cpu/gu);
    assert.equal(classDefMatches?.length, 1, 'exactly one classDef for role cpu');
    // Both placements assigned the same class
    assert.match(out, /class a contained-cpu/u);
    assert.match(out, /class b contained-cpu/u);
  });
});

void describe('RoleColorUtils.forRole', () => {
  void it('returns the same colors for the same role (determinism)', () => {
    const a = RoleColorUtils.forRole('cpu');
    const b = RoleColorUtils.forRole('cpu');
    assert.deepEqual(a, b);
  });

  void it('returns different fills for different roles (distinctness)', () => {
    const cpu = RoleColorUtils.forRole('cpu');
    const io  = RoleColorUtils.forRole('io');
    assert.notEqual(cpu.fill, io.fill);
  });

  void it('returns hex strings for fill, stroke, and text', () => {
    const c = RoleColorUtils.forRole('gpu');
    assert.match(c.fill,   /^#[0-9a-f]{6}$/iu);
    assert.match(c.stroke, /^#[0-9a-f]{6}$/iu);
    assert.match(c.text,   /^#[0-9a-f]{6}$/iu);
  });
});

void describe('MermaidRenderer.render: TerminalNodeType', () => {
  void it('renders a completed TerminalNodeType as a double-circle with outcome suffix', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t',
      '@type':    'DAG',
      'name':       't',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done' },
        },
        { '@id': 'urn:noocodex:dag:t/node/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' },
      ],
    };
    const out = MermaidRenderer.render(dag);
    // double-circle shape: (((label)))
    assert.match(out, /done\(\(\(.*\)\)\)/u);
    // outcome suffix present in label
    assert.match(out, /completed/u);
    // edge connects to the TerminalNodeType
    assert.match(out, /step -->\|success\| done/u);
  });

  void it('renders a failed TerminalNodeType as an asymmetric flag with outcome suffix', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t2',
      '@type':    'DAG',
      'name':       't2',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t2/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'error': 'abort' },
        },
        { '@id': 'urn:noocodex:dag:t2/node/abort', '@type': 'TerminalNode', 'name': 'abort', 'outcome': 'failed' },
      ],
    };
    const out = MermaidRenderer.render(dag);
    // asymmetric flag shape: name>label]
    assert.match(out, /abort>/u);
    assert.match(out, /\(failed\)/u);
    // edge connects to the TerminalNodeType
    assert.match(out, /step -->\|error\| abort/u);
  });

  void it('TerminalNodeType emits no outbound edges', () => {
    const terminalDone: TerminalNodeType = {
      '@id':     'urn:noocodex:dag:t3/node/done',
      '@type':   'TerminalNode',
      'name':    'done',
      'outcome': 'completed',
    };
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t3',
      '@type':    'DAG',
      'name':       't3',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t3/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done' },
        },
        terminalDone,
      ],
    };
    const out = MermaidRenderer.render(dag);
    // only one edge exists: step --> done
    const edgeLines = out.split('\n').filter((line) => line.includes('-->'));
    assert.equal(edgeLines.length, 1);
    const firstEdge = edgeLines[0] ?? '';
    assert.match(firstEdge, /step -->\|success\| done/u);
  });

  void it('two TerminalNodes in the same DAG both render with correct shapes', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t4',
      '@type':    'DAG',
      'name':       't4',
      'version':    '1',
      'entrypoint': 'step',
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:t4/node/step',
          '@type':  'SingleNode',
          'name':   'step',
          'node':   'step',
          'outputs': { 'success': 'done', 'error': 'abort' },
        },
        { '@id': 'urn:noocodex:dag:t4/node/done',  '@type': 'TerminalNode', 'name': 'done',  'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:t4/node/abort', '@type': 'TerminalNode', 'name': 'abort', 'outcome': 'failed' },
      ],
    };
    const out = MermaidRenderer.render(dag);
    // completed TerminalNodeType renders as double-circle
    assert.match(out, /done\(\(\(.*\)\)\)/u);
    // failed TerminalNodeType renders as asymmetric flag
    assert.match(out, /abort>/u);
    // both edges are present
    assert.match(out, /step -->\|success\| done/u);
    assert.match(out, /step -->\|error\| abort/u);
    // no synthetic END
    assert.doesNotMatch(out, /END\(\[end\]\)/u);
  });
});

// ── Reservoir-glyph fixtures (shared with CytoscapeRenderer reservoir tests) ──

/** ScatterNode with a reservoir config (keyField + capacity + idleMs). */
const RESERVOIR_DAG: DAGType = {
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
const RESERVOIR_NO_IDLEMS_DAG: DAGType = {
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
const PLAIN_SCATTER_DAG: DAGType = {
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

void describe('MermaidRenderer: reservoir glyph', () => {
  void it('reservoir-configured scatter carries keyField×capacity in a trapezoid label and gets the reservoir classDef + class assignment', () => {
    const out = MermaidRenderer.render(RESERVOIR_DAG);
    // Label contains the reservoir indicator with keyField and capacity.
    assert.match(out, /▣ tenantId ×50/u);
    // Shape is still [/.../] (trapezoid) — only the label content changes.
    assert.match(out, /buffer\[\/.*▣.*\/\]/u);
    // A classDef reservoir rule is emitted with the chosen reservoir blue.
    assert.match(out, /classDef reservoir fill:/u);
    assert.match(out, /classDef reservoir fill:#1e3a5f,stroke:#3b82f6,color:#bfdbfe/u);
    // The reservoir-configured node is assigned the reservoir class.
    assert.match(out, /class buffer reservoir/u);
    // classDef is emitted exactly once for a single reservoir scatter.
    const matches = out.match(/classDef reservoir/gu);
    assert.equal(matches?.length ?? 0, 1, 'exactly one classDef reservoir line');
  });

  void it('reservoir config without idleMs still emits the reservoir marking', () => {
    const out = MermaidRenderer.render(RESERVOIR_NO_IDLEMS_DAG);
    assert.match(out, /▣ region ×100/u);
    assert.match(out, /classDef reservoir fill:/u);
    assert.match(out, /class batch reservoir/u);
  });

  // ── Parity guard ──────────────────────────────────────────────────────────

  void it('plain (non-reservoir) scatter renders as a bare trapezoid with no reservoir marking, classDef, or class assignment', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG);
    // Shape is plain [/label/] without any augmentation.
    assert.match(out, /fan\[\/fan\/\]/u);
    // No reservoir indicator in the label.
    assert.doesNotMatch(out, /▣/u);
    // No reservoir classDef and no reservoir class assignment.
    assert.doesNotMatch(out, /classDef reservoir/u);
    assert.doesNotMatch(out, /class fan reservoir/u);
  });
});
