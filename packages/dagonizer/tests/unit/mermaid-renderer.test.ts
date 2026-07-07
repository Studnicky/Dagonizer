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
      'entrypoints': { 'main': 'greet' },
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
    assert.match(out, /flowchart TB/u);
    assert.match(out, /greet\["greet"\]/u);
    assert.match(out, /greet -->\|success\| end_node/u);
    assert.match(out, /end_node\(\(\("end"\)\)\)/u);
    assert.doesNotMatch(out, /-->\|success\| end$/mu);
  });

  void it('renders a ScatterNode as a trapezoid', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:fan',
      '@type':    'DAG',
      'name':       'fan',
      'version':    '1',
      'entrypoints': { 'main': 'fan' },
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
    assert.match(out, /fan\[\/"fan"\/\]/u);
    assert.match(out, /fan -->\|all-success\| end/u);
  });

  void it('renders an EmbeddedDAGNode as a subroutine', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:deep',
      '@type':    'DAG',
      'name':       'deep',
      'version':    '1',
      'entrypoints': { 'main': 'enrich' },
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
    assert.match(out, /enrich\[\["enrich"\]\]/u);
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
      'entrypoints': { 'main': 'step' },
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
    assert.match(out, /setup\(\["setup \(pre\)"\]\)/u);
    assert.doesNotMatch(out, /setup\(\[setup \(pre\)\]\)/u);
    // PhaseNode emits no outgoing edges
    const edgeLines = out.split('\n').filter((line) => line.includes('-->') && line.includes('setup'));
    assert.equal(edgeLines.length, 0);
    // does not crash; returns valid flowchart
    assert.match(out, /flowchart TB/u);
  });

  void it('renders a post-phase PhaseNode with phase suffix in label', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:ph2',
      '@type':    'DAG',
      'name':       'ph2',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
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
    assert.match(out, /teardown\(\["teardown \(post\)"\]\)/u);
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
      'entrypoints': { 'main': 'in-process' },
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
    assert.match(out, /worker-dag\[\["worker-dag"\]\]/u);
  });

  void it('emits per-role classDef and class assignment for a contained dag-body ScatterNode', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:scatter-worker',
      '@type':    'DAG',
      'name':       'scatter-worker',
      'version':    '1',
      'entrypoints': { 'main': 'fan' },
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
    assert.match(out, /fan\[\/"fan"\/\]/u);
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
      'entrypoints': { 'main': 'step' },
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
      'entrypoints': { 'main': 'cpu-work' },
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
    assert.match(out, /cpu-work\[\/"cpu-work"\/\]/u);
    assert.match(out, /io-work\[\["io-work"\]\]/u);
  });

  void it('assigns the SAME class to two placements with the SAME role (grouping)', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:same-role',
      '@type':    'DAG',
      'name':     'same-role',
      'version':  '1',
      'entrypoints': { 'main': 'a' },
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
  void it('renders a completed TerminalNodeType as a double-circle with outcome suffix (keep mode)', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t',
      '@type':    'DAG',
      'name':       't',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
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
    // Use terminalAnnotations:'keep' to preserve the outcome suffix in the label.
    const out = MermaidRenderer.render(dag, { 'terminalAnnotations': 'keep' });
    // double-circle shape: (((label)))
    assert.match(out, /done\(\(\(.*\)\)\)/u);
    // outcome suffix present in label when annotations are kept
    assert.match(out, /completed/u);
    // edge connects to the TerminalNodeType
    assert.match(out, /step -->\|success\| done/u);
  });

  void it('renders a failed TerminalNodeType as an asymmetric flag with outcome suffix (keep mode)', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:t2',
      '@type':    'DAG',
      'name':       't2',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
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
    // Use terminalAnnotations:'keep' to preserve the outcome suffix in the label.
    const out = MermaidRenderer.render(dag, { 'terminalAnnotations': 'keep' });
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
      'entrypoints': { 'main': 'step' },
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
      'entrypoints': { 'main': 'step' },
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
  'entrypoints': { 'main': 'buffer' },
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir/node/buffer',
      '@type':    'ScatterNode',
      'name':     'buffer',
      'body':     { 'node': 'worker' },
      'source':   'events',
      'gather':   { 'strategy': 'discard' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'tenantId', 'capacity': 50, 'idleMs': 5000 } },
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
  'entrypoints': { 'main': 'batch' },
  'nodes': [
    {
      '@id':      'urn:noocodex:dag:reservoir-no-idle/node/batch',
      '@type':    'ScatterNode',
      'name':     'batch',
      'body':     { 'node': 'processor' },
      'source':   'records',
      'gather':   { 'strategy': 'discard' },
      'execution': { 'mode': 'reservoir', 'reservoir': { 'keyField': 'region', 'capacity': 100 } },
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
  'entrypoints': { 'main': 'fan' },
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
    assert.match(out, /fan\[\/"fan"\/\]/u);
    // No reservoir indicator in the label.
    assert.doesNotMatch(out, /▣/u);
    // No reservoir classDef and no reservoir class assignment.
    assert.doesNotMatch(out, /classDef reservoir/u);
    assert.doesNotMatch(out, /class fan reservoir/u);
  });
});

// ── MermaidRenderOptionsType: new rendering-correctness passes ─────────────

/** DAG with a colon-namespaced placement name that would break Mermaid's lexer. */
const COLON_NODE_DAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:colon-test',
  '@type':    'DAG',
  'name':       'colon-test',
  'version':    '1',
  'entrypoints': { 'main': 'extract:class-base' },
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:colon-test/node/extract:class-base',
      '@type':   'SingleNode',
      'name':    'extract:class-base',
      'node':    'extractor',
      'outputs': { 'success': 'end' },
    },
    { '@id': 'urn:noocodex:dag:colon-test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
  ],
};

void describe('MermaidRenderer: options — orientation', () => {
  void it('default orientation is TB', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG);
    assert.match(out, /^flowchart TB$/mu);
  });

  void it('orientation LR override emits flowchart LR', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG, { 'orientation': 'LR' });
    assert.match(out, /^flowchart LR$/mu);
  });

  void it('orientation RL override emits flowchart RL', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG, { 'orientation': 'RL' });
    assert.match(out, /^flowchart RL$/mu);
  });

  void it('orientation BT override emits flowchart BT', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG, { 'orientation': 'BT' });
    assert.match(out, /^flowchart BT$/mu);
  });
});

void describe('MermaidRenderer: options — render style', () => {
  void it('emits Mermaid init config for pluggable font and layout style', () => {
    const out = MermaidRenderer.render(PLAIN_SCATTER_DAG, {
      'theme': {
        'fontFamily': 'JetBrains Mono, monospace',
        'fontSize':   '18px',
        'nodeSpacing': 96,
        'rankSpacing': 112,
        'padding':     32,
      },
    });

    assert.match(out, /^%%\{init:/u);
    assert.match(out, /"fontFamily":"JetBrains Mono, monospace"/u);
    assert.match(out, /"fontSize":"18px"/u);
    assert.match(out, /"nodeSpacing":96/u);
    assert.match(out, /"rankSpacing":112/u);
    assert.match(out, /"padding":32/u);
  });
});

void describe('MermaidRenderer: options — node-id sanitization', () => {
  void it('replaces `:` in bare node IDs with `_` by default', () => {
    const out = MermaidRenderer.render(COLON_NODE_DAG);
    // The bare id in the shape definition uses `_` not `:`.
    assert.match(out, /extract_class-base\[/u);
    // The label INSIDE the brackets keeps the original colon.
    assert.match(out, /\["extract:class-base"\]/u);
  });

  void it('edge target ids are also sanitized', () => {
    const out = MermaidRenderer.render(COLON_NODE_DAG);
    // Edge from the colon-named source to `end`; source id uses `_`.
    assert.match(out, /extract_class-base -->/u);
  });

  void it('sanitizes Mermaid reserved node ids in definitions, edges, and classes', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:reserved-id',
      '@type':    'DAG',
      'name':       'reserved-id',
      'version':    '1',
      'entrypoints': { 'main': 'class' },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:reserved-id/node/class',
          '@type':   'SingleNode',
          'name':    'class',
          'node':    'noop',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':       'urn:noocodex:dag:reserved-id/node/end',
          '@type':     'EmbeddedDAGNode',
          'name':      'end',
          'dag':       'inner',
          'container': 'cpu',
          'outputs':   { 'success': 'default' },
        },
        {
          '@id':     'urn:noocodex:dag:reserved-id/node/default',
          '@type':   'TerminalNode',
          'name':    'default',
          'outcome': 'completed',
        },
      ],
    };

    const out = MermaidRenderer.render(dag);
    assert.match(out, /class_node\["class"\]/u);
    assert.match(out, /class_node -->\|success\| end_node/u);
    assert.match(out, /end_node\[\["end"\]\]/u);
    assert.match(out, /end_node -->\|success\| default_node/u);
    assert.match(out, /default_node\(\(\("default"\)\)\)/u);
    assert.match(out, /class end_node contained-cpu/u);
    assert.doesNotMatch(out, /-->\|success\| end$/mu);
    assert.doesNotMatch(out, /^ {2}end\[\[/mu);
  });

  void it('sanitizes node ids that start with a Mermaid reserved token', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:reserved-prefix-id',
      '@type':    'DAG',
      'name':       'reserved-prefix-id',
      'version':    '1',
      'entrypoints': { 'main': 'build-request' },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:reserved-prefix-id/node/build-request',
          '@type':   'SingleNode',
          'name':    'build-request',
          'node':    'build-request',
          'outputs': { 'error': 'end-error' },
        },
        {
          '@id':     'urn:noocodex:dag:reserved-prefix-id/node/end-error',
          '@type':   'TerminalNode',
          'name':    'end-error',
          'outcome': 'failed',
        },
      ],
    };

    const out = MermaidRenderer.render(dag);
    assert.match(out, /build-request -->\|error\| node_end-error/u);
    assert.match(out, /node_end-error>"end-error"\]/u);
    assert.doesNotMatch(out, /-->\|error\| end-error/u);
  });

  void it('classDef and `class ` directive lines are NOT mangled by sanitization', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:sanitize-classDef-guard',
      '@type':    'DAG',
      'name':       'sanitize-classDef-guard',
      'version':    '1',
      'entrypoints': { 'main': 'embed' },
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:sanitize-classDef-guard/node/embed',
          '@type':     'EmbeddedDAGNode',
          'name':      'embed',
          'dag':       'inner',
          'container': 'cpu',
          'outputs':   { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:sanitize-classDef-guard/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const out = MermaidRenderer.render(dag);
    // classDef line retains fill:/stroke:/color: colons intact.
    assert.match(out, /classDef contained-cpu fill:#/u);
    assert.match(out, /stroke:#/u);
    assert.match(out, /color:#/u);
    // `class ` assignment line is also intact.
    assert.match(out, /class embed contained-cpu/u);
  });

  void it('sanitization can be disabled via sanitizeNodeIds: false', () => {
    const out = MermaidRenderer.render(COLON_NODE_DAG, { 'sanitizeNodeIds': false });
    // The original colon is preserved in the bare id position.
    assert.match(out, /extract:class-base\[/u);
  });
});

void describe('MermaidRenderer: options — terminal-annotation strip', () => {
  void it('strips \\n(completed) from completed terminal node label by default', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:strip-completed',
      '@type':    'DAG',
      'name':       'strip-completed',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:strip-completed/node/step',
          '@type':   'SingleNode',
          'name':    'step',
          'node':    'worker',
          'outputs': { 'success': 'done' },
        },
        { '@id': 'urn:noocodex:dag:strip-completed/node/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' },
      ],
    };
    const out = MermaidRenderer.render(dag);
    // The literal `\n(completed)` suffix is stripped from the shape line.
    assert.doesNotMatch(out, /\\n\(completed\)/u);
    // The node still renders as a double-circle (shape syntax preserved).
    assert.match(out, /done\(\(\(/u);
  });

  void it('strips \\n(failed) from failed terminal node label by default', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:strip-failed',
      '@type':    'DAG',
      'name':       'strip-failed',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:strip-failed/node/step',
          '@type':   'SingleNode',
          'name':    'step',
          'node':    'worker',
          'outputs': { 'error': 'abort' },
        },
        { '@id': 'urn:noocodex:dag:strip-failed/node/abort', '@type': 'TerminalNode', 'name': 'abort', 'outcome': 'failed' },
      ],
    };
    const out = MermaidRenderer.render(dag);
    // The literal `\n(failed)` suffix is stripped from the shape line.
    assert.doesNotMatch(out, /\\n\(failed\)/u);
    // The node still renders as an asymmetric flag (shape syntax preserved).
    assert.match(out, /abort>/u);
  });

  void it('keeps terminal annotations when terminalAnnotations is "keep"', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:keep-annotations',
      '@type':    'DAG',
      'name':       'keep-annotations',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
      'nodes': [
        {
          '@id':     'urn:noocodex:dag:keep-annotations/node/step',
          '@type':   'SingleNode',
          'name':    'step',
          'node':    'worker',
          'outputs': { 'success': 'done' },
        },
        { '@id': 'urn:noocodex:dag:keep-annotations/node/done', '@type': 'TerminalNode', 'name': 'done', 'outcome': 'completed' },
      ],
    };
    const out = MermaidRenderer.render(dag, { 'terminalAnnotations': 'keep' });
    // The literal \n(completed) is preserved in the output.
    assert.match(out, /\\n\(completed\)/u);
  });

  void it('classDef and style directive lines are NOT altered by the annotation strip pass', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:strip-directive-guard',
      '@type':    'DAG',
      'name':       'strip-directive-guard',
      'version':    '1',
      'entrypoints': { 'main': 'work' },
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:strip-directive-guard/node/work',
          '@type':     'EmbeddedDAGNode',
          'name':      'work',
          'dag':       'inner',
          'container': 'cpu',
          'outputs':   { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:strip-directive-guard/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const out = MermaidRenderer.render(dag);
    // classDef line is not mangled (fill:/stroke:/color: colons remain).
    assert.match(out, /classDef contained-cpu fill:#/u);
  });
});

void describe('MermaidRenderer: options — containerTints theme override', () => {
  void it('containerTints[role] overrides the default hash-derived fill for that role', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:tints-test',
      '@type':    'DAG',
      'name':       'tints-test',
      'version':    '1',
      'entrypoints': { 'main': 'task' },
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:tints-test/node/task',
          '@type':     'EmbeddedDAGNode',
          'name':      'task',
          'dag':       'sub',
          'container': 'gpu',
          'outputs':   { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:tints-test/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    const customFill = '#ff00ff';
    const out = MermaidRenderer.render(dag, { 'theme': { 'containerTints': { 'gpu': customFill } } });
    // classDef for `gpu` must use the override fill.
    assert.match(out, new RegExp(`classDef contained-gpu fill:${customFill}`, 'u'));
    // class assignment for the node is still present.
    assert.match(out, /class task contained-gpu/u);
  });

  void it('roles not in containerTints keep the default palette fill', () => {
    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:tints-partial',
      '@type':    'DAG',
      'name':       'tints-partial',
      'version':    '1',
      'entrypoints': { 'main': 'a' },
      'nodes': [
        {
          '@id':       'urn:noocodex:dag:tints-partial/node/a',
          '@type':     'EmbeddedDAGNode',
          'name':      'a',
          'dag':       'sub-a',
          'container': 'cpu',
          'outputs':   { 'success': 'b' },
        },
        {
          '@id':       'urn:noocodex:dag:tints-partial/node/b',
          '@type':     'EmbeddedDAGNode',
          'name':      'b',
          'dag':       'sub-b',
          'container': 'io',
          'outputs':   { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:tints-partial/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
      ],
    };
    // Only override `io`; `cpu` should keep its palette colour.
    const out = MermaidRenderer.render(dag, { 'theme': { 'containerTints': { 'io': '#abcdef' } } });
    const cpuColors = RoleColorUtils.forRole('cpu');
    assert.match(out, new RegExp(`classDef contained-cpu fill:${cpuColors.fill}`, 'u'));
    assert.match(out, /classDef contained-io fill:#abcdef/u);
  });
});
