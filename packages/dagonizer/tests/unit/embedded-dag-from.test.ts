/**
 * Tests for runtime DagReference resolution.
 *
 * `EmbeddedDAGNode` and `ScatterNode` can read the DAG IRI from a dotted
 * state or item path at execution time in addition to build-time literal
 * DAG references. An empty or non-candidate DAG IRI routes to the placement's
 * `error` output without throwing. The validator enforces that every dynamic
 * reference declares its candidate DAG set.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import type { Batch } from '../../src/entities/batch/Batch.js';
import { SCATTER_PROGRESS_KEY } from '../../src/entities/constants/ProgressKey.js';
import { DAG_CONTEXT, type DAGType } from '../../src/entities/dag/DAG.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { DagReferenceResolver } from '../../src/execution/DagReferenceResolver.js';
import { DagGraphProjector } from '../../src/graph/DagGraphProjector.js';
import { DagGraphQueries } from '../../src/graph/DagGraphQueries.js';
import { InMemoryTopologyStore } from '../../src/graph/InMemoryTopologyStore.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A shared execution probe. Scatter runs each item's body on an isolated clone,
 * so per-clone state never reaches the parent; the probe counts real child-dag
 * executions across every clone regardless of the gather strategy. It is a plain
 * data object injected via constructor — not a callback.
 */
class ExecutionProbe {
  count = 0;
}

const CHILD_A_DAG_IRI = 'urn:noocodec:dag:child-a';
const CHILD_EXPANDED_DAG_IRI = 'https://noocodec.dev/dag/default#child-expanded';
const MULTI_ENTRY_CHILD_A_DAG_IRI = 'urn:noocodec:dag:multi-entry-child-a';
const MULTI_ENTRY_CHILD_B_DAG_IRI = 'urn:noocodec:dag:multi-entry-child-b';
const SCATTER_CHILD_DAG_IRI = 'urn:noocodec:dag:scatter-child';
const SCATTER_EXPANDED_CHILD_DAG_IRI = 'https://noocodec.dev/dag/default#scatter-expanded-child';
const RETAINED_SELECTED_CHILD_A_DAG_IRI = 'urn:noocodec:dag:retained-selected-child-a';
const RETAINED_SELECTED_CHILD_B_DAG_IRI = 'urn:noocodec:dag:retained-selected-child-b';
const SELECTED_CHILD_DAG_IRI = 'https://noocodec.dev/dag/default#selected-child';
const SOME_CHILD_DAG_IRI = 'urn:noocodec:dag:some-child';
const VALID_CHILD_LITERAL_DAG_IRI = 'urn:noocodec:dag:valid-child-literal';
const VALID_CHILD_DYNAMIC_DAG_IRI = 'urn:noocodec:dag:valid-child-dynamic';
const EMBEDDED_MODE_CHILD_DAG_IRI = 'urn:noocodec:dag:embedded-mode-child';
const SCATTER_MODE_CHILD_DAG_IRI = 'urn:noocodec:dag:scatter-mode-child';
const PARENT_DAG_IRI = 'urn:noocodec:dag:embedded-from-parent';
const PARENT_EXPANDED_DAG_IRI = 'urn:noocodec:dag:embedded-from-parent-expanded';
const MULTI_ENTRY_PARENT_DAG_IRI = 'urn:noocodec:dag:multi-entry-embedded-parent';
const PARENT_MISSING_DAG_IRI = 'urn:noocodec:dag:embedded-from-parent-missing';
const PARENT_EMPTY_DAG_IRI = 'urn:noocodec:dag:embedded-from-parent-empty';
const SCATTER_PARENT_DAG_IRI = 'urn:noocodec:dag:embedded-from-scatter-parent';
const SCATTER_EXPANDED_PARENT_DAG_IRI = 'urn:noocodec:dag:embedded-from-scatter-expanded-parent';
const RETAINED_SELECTED_PARENT_DAG_IRI = 'urn:noocodec:dag:retained-selected-parent';
const SCATTER_BAD_DAG_IRI = 'urn:noocodec:dag:embedded-from-scatter-bad';
const SCATTER_SCALE_PARENT_DAG_IRI = 'urn:noocodec:dag:embedded-from-scatter-scale-parent';
const VALID_LITERAL_DAG_IRI = 'urn:noocodec:dag:valid-literal';
const VALID_FROM_ONLY_DAG_IRI = 'urn:noocodec:dag:valid-from-only';
const BOGUS_BOTH_DAG_IRI = 'urn:noocodec:dag:bogus-both';
const BOGUS_NEITHER_DAG_IRI = 'urn:noocodec:dag:bogus-neither';
const BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI = 'urn:noocodec:dag:bad-embedded-reference-mode';
const BAD_SCATTER_REFERENCE_MODE_DAG_IRI = 'urn:noocodec:dag:bad-scatter-reference-mode';

class RoutingState extends NodeStateBase {
  /** The DAG IRI placed here by a setup node and read by the dynamic embed reference. */
  selectedDag = '';
  /** Execution counter threaded through the cardinality-1 embed via state mapping. */
  executed = 0;
  /** Scatter items: each names its own body dag. */
  items: Array<{ dagIri: string }> = [{ 'dagIri': SCATTER_CHILD_DAG_IRI }, { 'dagIri': SCATTER_CHILD_DAG_IRI }];
}

/** Increments `state.executed` (for state round-trip) and the shared probe. */
class IncrNode extends MonadicNode<RoutingState, 'success' | 'error'> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } }; }
  readonly #probe: ExecutionProbe;

  constructor(name: string, probe: ExecutionProbe) {
    super();
    this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`;
    this.name = name;
    this.#probe = probe;
  }

  override async execute(
    batch: Batch<RoutingState>,
    _ctx: NodeContextType,
  ): Promise<Map<'success' | 'error', Batch<RoutingState>>> {
    for (const item of batch) {
      item.state.executed += 1;
      this.#probe.count += 1;
    }
    return new Map([['success', batch]]);
  }
}

/** Increments the probe and optionally aborts after the first scatter item. */
class AbortOnFirstItemNode extends MonadicNode<RoutingState, 'success'> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
  readonly #probe: ExecutionProbe;
  readonly #controller: AbortController | null;

  constructor(name: string, probe: ExecutionProbe, controller: AbortController | null) {
    super();
    this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`;
    this.name = name;
    this.#probe = probe;
    this.#controller = controller;
  }

  override async execute(
    batch: Batch<RoutingState>,
    _ctx: NodeContextType,
  ): Promise<Map<'success', Batch<RoutingState>>> {
    for (const item of batch) {
      this.#probe.count += 1;
      if (item.state.getMetadata('itemIndex') === 0) this.#controller?.abort();
    }
    return new Map([['success', batch]]);
  }
}

/** Sets `state.selectedDag` to the provided value then routes success. */
class SetDagNode extends MonadicNode<RoutingState, 'success'> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
  readonly #dagName: string;

  constructor(name: string, dagName: string) {
    super();
    this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`;
    this.name = name;
    this.#dagName = dagName;
  }

  override async execute(
    batch: Batch<RoutingState>,
    _ctx: NodeContextType,
  ): Promise<Map<'success', Batch<RoutingState>>> {
    for (const item of batch) item.state.selectedDag = this.#dagName;
    return new Map([['success', batch]]);
  }
}

const placementIri = (dagIri: string, placementName: string): string => `${dagIri}/node/${placementName}`;

/** DAG-shaped fixtures: terminals and a minimal child DAG. */
class TestDag {
  private constructor() { /* static-only */ }

  static terminal(dagIri: string): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dagIri, 'end'),
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    };
  }

  static failedTerminal(dagIri: string): DAGType['nodes'][number] {
    return {
      '@id': placementIri(dagIri, 'end-fail'),
      '@type':   'TerminalNode',
      'name':    'end-fail',
      'outcome': 'failed',
    };
  }

  /** A minimal 1-node child DAG that runs the `incr` node. */
  static child(iri: string, name: string): DAGType {
    return TestDag.childWithNode(iri, name, 'urn:noocodec:node:incr');
  }

  static childWithNode(iri: string, name: string, nodeName: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id': iri,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoints': { 'main': placementIri(iri, 'run') },
      'nodes': [
        {
          '@id': placementIri(iri, 'run'),
          '@type': 'SingleNode',
          'name':  'run',
          'node':  nodeName,
          'outputs': { 'success': placementIri(iri, 'end'), 'error': placementIri(iri, 'end-fail') },
        },
        TestDag.terminal(iri),
        TestDag.failedTerminal(iri),
      ],
    };
  }
}

// ── EmbeddedDAGNode DagReference tests ────────────────────────────────────────

void describe('EmbeddedDAGNode: DagReference runtime resolution', () => {
  void it('resolves the DAG IRI from a state path and executes the child dag', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const setNode = new SetDagNode('set-dag', CHILD_A_DAG_IRI);
    const childDag = TestDag.child(CHILD_A_DAG_IRI, 'child-a');

    const parentDag = new DAGBuilder(PARENT_DAG_IRI, '1', { 'name': 'parent' })
      .node(placementIri(PARENT_DAG_IRI, 'set-dag'), setNode, { 'success': placementIri(PARENT_DAG_IRI, 'invoke') }, { 'name': 'set-dag' })
      .embed<RoutingState, RoutingState>(placementIri(PARENT_DAG_IRI, 'invoke'), { 'from': 'state', 'path': 'selectedDag', 'candidates': [CHILD_A_DAG_IRI] }, { 'success': placementIri(PARENT_DAG_IRI, 'end'), 'error': placementIri(PARENT_DAG_IRI, 'end-fail') }, {
        'inputs':  { 'executed': 'executed' },
        'outputs': { 'executed': 'executed' },
        'name': 'invoke',
      })
      .terminal(placementIri(PARENT_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(PARENT_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerNode(setNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute(PARENT_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 1, 'child dag should have executed once');
    assert.equal(state.executed, 1, 'child increment maps back into parent state');
  });

  void it('resolves an expanded DAG IRI from a state path and executes the declared candidate', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const setNode = new SetDagNode('set-dag', CHILD_EXPANDED_DAG_IRI);
    const childDag = TestDag.child(CHILD_EXPANDED_DAG_IRI, 'child-expanded');
    const store = new InMemoryTopologyStore();

    const parentDag = new DAGBuilder(PARENT_EXPANDED_DAG_IRI, '1', { 'name': 'parent-expanded' })
      .node(placementIri(PARENT_EXPANDED_DAG_IRI, 'set-dag'), setNode, { 'success': placementIri(PARENT_EXPANDED_DAG_IRI, 'invoke') }, { 'name': 'set-dag' })
      .embed<RoutingState, RoutingState>(placementIri(PARENT_EXPANDED_DAG_IRI, 'invoke'), { 'from': 'state', 'path': 'selectedDag', 'candidates': [CHILD_EXPANDED_DAG_IRI] }, { 'success': placementIri(PARENT_EXPANDED_DAG_IRI, 'end'), 'error': placementIri(PARENT_EXPANDED_DAG_IRI, 'end-fail') }, {
        'inputs':  { 'executed': 'executed' },
        'outputs': { 'executed': 'executed' },
        'name': 'invoke',
      })
      .terminal(placementIri(PARENT_EXPANDED_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(PARENT_EXPANDED_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    dispatcher.registerNode(incrNode);
    dispatcher.registerNode(setNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute(PARENT_EXPANDED_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 1);
    assert.equal(state.executed, 1);
    assert.deepEqual(
      DagGraphQueries.selectedDagRows(store),
      [{
        'ownerIri': parentDag.nodes.find((placement) => placement.name === 'invoke')?.['@id'] ?? '',
        'dagIri':   DagGraphProjector.dagIri(childDag),
      }],
    );
  });

  void it('partitions converged multi-entry batches by each state dynamic dag selection', async () => {
    const probeA = new ExecutionProbe();
    const probeB = new ExecutionProbe();
    const childADag = TestDag.childWithNode(MULTI_ENTRY_CHILD_A_DAG_IRI, 'multi-entry-child-a', 'urn:noocodec:node:incr-a');
    const childBDag = TestDag.childWithNode(MULTI_ENTRY_CHILD_B_DAG_IRI, 'multi-entry-child-b', 'urn:noocodec:node:incr-b');
    const store = new InMemoryTopologyStore();

    const parentDag = new DAGBuilder(MULTI_ENTRY_PARENT_DAG_IRI, '1', { 'name': 'multi-entry-embedded-parent' })
      .entrypoints({ 'alpha': placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'set-a'), 'beta': placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'set-b') })
      .node(placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'set-a'), new SetDagNode('set-a', MULTI_ENTRY_CHILD_A_DAG_IRI), { 'success': placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'invoke') }, { 'name': 'set-a' })
      .node(placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'set-b'), new SetDagNode('set-b', MULTI_ENTRY_CHILD_B_DAG_IRI), { 'success': placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'invoke') }, { 'name': 'set-b' })
      .embed<RoutingState, RoutingState>(placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'invoke'), {
        'from': 'state',
        'path': 'selectedDag',
        'candidates': [MULTI_ENTRY_CHILD_A_DAG_IRI, MULTI_ENTRY_CHILD_B_DAG_IRI],
      }, { 'success': placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'end'), 'error': placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'end-fail') }, {
        'inputs':  { 'executed': 'executed' },
        'outputs': { 'executed': 'executed' },
        'name': 'invoke',
      })
      .terminal(placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(MULTI_ENTRY_PARENT_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    dispatcher.registerNode(new IncrNode('incr-a', probeA));
    dispatcher.registerNode(new IncrNode('incr-b', probeB));
    dispatcher.registerNode(new SetDagNode('set-a', MULTI_ENTRY_CHILD_A_DAG_IRI));
    dispatcher.registerNode(new SetDagNode('set-b', MULTI_ENTRY_CHILD_B_DAG_IRI));
    dispatcher.registerDAG(childADag);
    dispatcher.registerDAG(childBDag);
    dispatcher.registerDAG(parentDag);

    const result = await dispatcher.execute(MULTI_ENTRY_PARENT_DAG_IRI, new RoutingState());

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probeA.count, 1);
    assert.equal(probeB.count, 1);
    const ownerBaseIri = parentDag.nodes.find((placement) => placement.name === 'invoke')?.['@id'] ?? '';
    assert.deepEqual(
      [...DagGraphQueries.selectedDagRows(store)].sort((a, b) => a.ownerIri.localeCompare(b.ownerIri)),
      [
        { 'ownerIri': `${ownerBaseIri}/item/0`, 'dagIri': DagGraphProjector.dagIri(childADag) },
        { 'ownerIri': `${ownerBaseIri}/item/0`, 'dagIri': DagGraphProjector.dagIri(childBDag) },
      ],
    );
  });

  void it('routes to error when the state value is not in the candidate set', async () => {
    const setNode = new SetDagNode('set-dag', 'urn:noocodec:dag:does-not-exist');
    const childDag = TestDag.child(CHILD_A_DAG_IRI, 'child-a');

    const parentDag = new DAGBuilder(PARENT_MISSING_DAG_IRI, '1', { 'name': 'parent-missing' })
      .node(placementIri(PARENT_MISSING_DAG_IRI, 'set-dag'), setNode, { 'success': placementIri(PARENT_MISSING_DAG_IRI, 'invoke') }, { 'name': 'set-dag' })
      .embed(placementIri(PARENT_MISSING_DAG_IRI, 'invoke'), { 'from': 'state', 'path': 'selectedDag', 'candidates': [CHILD_A_DAG_IRI] }, { 'success': placementIri(PARENT_MISSING_DAG_IRI, 'end-ok'), 'error': placementIri(PARENT_MISSING_DAG_IRI, 'end-fail') }, { 'name': 'invoke' })
      .terminal(placementIri(PARENT_MISSING_DAG_IRI, 'end-ok'), { 'name': 'end-ok' })
      .terminal(placementIri(PARENT_MISSING_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(setNode);
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute(PARENT_MISSING_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'failed', 'non-candidate dag → error output → failed terminal');
  });

  void it('routes to error when dynamic reference path resolves to an empty string', async () => {
    // selectedDag starts as '' — an empty string is not a valid DAG IRI.
    const parentDag = new DAGBuilder(PARENT_EMPTY_DAG_IRI, '1', { 'name': 'parent-empty' })
      .embed(placementIri(PARENT_EMPTY_DAG_IRI, 'invoke'), { 'from': 'state', 'path': 'selectedDag', 'candidates': [CHILD_A_DAG_IRI] }, { 'success': placementIri(PARENT_EMPTY_DAG_IRI, 'end-ok'), 'error': placementIri(PARENT_EMPTY_DAG_IRI, 'end-fail') }, { 'name': 'invoke' })
      .terminal(placementIri(PARENT_EMPTY_DAG_IRI, 'end-ok'), { 'name': 'end-ok' })
      .terminal(placementIri(PARENT_EMPTY_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child(CHILD_A_DAG_IRI, 'child-a'));
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState(); // selectedDag === ''
    const result = await dispatcher.execute(PARENT_EMPTY_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'failed');
  });
});

// ── ScatterNode DagReference tests ────────────────────────────────────────────

void describe('ScatterNode: DagReference runtime resolution', () => {
  void it('resolves each item DAG IRI from clone state and runs the sub-dag per item', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const childDag = TestDag.child(SCATTER_CHILD_DAG_IRI, 'scatter-child');

    // Each scatter item names its own body dag from the item directly.
    const parentDag = new DAGBuilder(SCATTER_PARENT_DAG_IRI, '1', { 'name': 'scatter-parent' })
      .scatter(placementIri(SCATTER_PARENT_DAG_IRI, 'scatter'), 'items', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': [SCATTER_CHILD_DAG_IRI] } }, {
        'all-success': placementIri(SCATTER_PARENT_DAG_IRI, 'end'),
        'partial':     placementIri(SCATTER_PARENT_DAG_IRI, 'end'),
        'all-error':   placementIri(SCATTER_PARENT_DAG_IRI, 'end'),
        'empty': placementIri(SCATTER_PARENT_DAG_IRI, 'end'),
      }, { 'name': 'scatter' })
      .terminal(placementIri(SCATTER_PARENT_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [{ 'dagIri': SCATTER_CHILD_DAG_IRI }, { 'dagIri': SCATTER_CHILD_DAG_IRI }, { 'dagIri': SCATTER_CHILD_DAG_IRI }];
    const result = await dispatcher.execute(SCATTER_PARENT_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 3, 'child dag should run once per item');
  });

  void it('resolves expanded DAG IRIs from scatter items and runs the declared candidate', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const childDag = TestDag.child(SCATTER_EXPANDED_CHILD_DAG_IRI, 'scatter-expanded-child');
    const store = new InMemoryTopologyStore();

    const parentDag = new DAGBuilder(SCATTER_EXPANDED_PARENT_DAG_IRI, '1', { 'name': 'scatter-expanded-parent' })
      .scatter(placementIri(SCATTER_EXPANDED_PARENT_DAG_IRI, 'scatter'), 'items', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': [SCATTER_EXPANDED_CHILD_DAG_IRI] } }, {
        'all-success': placementIri(SCATTER_EXPANDED_PARENT_DAG_IRI, 'end'),
        'partial':     placementIri(SCATTER_EXPANDED_PARENT_DAG_IRI, 'end'),
        'all-error':   placementIri(SCATTER_EXPANDED_PARENT_DAG_IRI, 'end'),
        'empty': placementIri(SCATTER_EXPANDED_PARENT_DAG_IRI, 'end'),
      }, { 'name': 'scatter' })
      .terminal(placementIri(SCATTER_EXPANDED_PARENT_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [
      { 'dagIri': SCATTER_EXPANDED_CHILD_DAG_IRI },
      { 'dagIri': SCATTER_EXPANDED_CHILD_DAG_IRI },
    ];
    const result = await dispatcher.execute(SCATTER_EXPANDED_PARENT_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 2);
    const ownerBaseIri = parentDag.nodes.find((placement) => placement.name === 'scatter')?.['@id'] ?? '';
    const selectedDagIri = DagGraphProjector.dagIri(childDag);
    assert.deepEqual(
      DagGraphQueries.selectedDagRows(store),
      [
        { 'ownerIri': `${ownerBaseIri}/item/0`, 'dagIri': selectedDagIri },
        { 'ownerIri': `${ownerBaseIri}/item/1`, 'dagIri': selectedDagIri },
      ],
    );
    assert.deepEqual(DagGraphQueries.selectedDagIris(store), [selectedDagIri]);
  });

  void it('retained scatter resume rebinds selected DAGs from checkpointed acked items', async () => {
    const controller = new AbortController();
    const firstProbe = new ExecutionProbe();
    const resumeProbe = new ExecutionProbe();
    const childADag = TestDag.child(RETAINED_SELECTED_CHILD_A_DAG_IRI, 'retained-selected-child-a');
    const childBDag = TestDag.child(RETAINED_SELECTED_CHILD_B_DAG_IRI, 'retained-selected-child-b');
    const parentDag = new DAGBuilder(RETAINED_SELECTED_PARENT_DAG_IRI, '1', { 'name': 'retained-selected-parent' })
      .scatter(placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'scatter'), 'items', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': [RETAINED_SELECTED_CHILD_A_DAG_IRI, RETAINED_SELECTED_CHILD_B_DAG_IRI] } }, {
        'all-success': placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'end'),
        'partial':     placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'end'),
        'all-error':   placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'end'),
        'empty':       placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'end'),
      }, {
        'execution': { 'mode': 'item', 'concurrency': 1 },
        'name': 'scatter',
      })
      .terminal(placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const childAIri = DagGraphProjector.dagIri(childADag);
    const childBIri = DagGraphProjector.dagIri(childBDag);
    const firstDispatcher = new Dagonizer<RoutingState>();
    firstDispatcher.registerNode(new AbortOnFirstItemNode('incr', firstProbe, controller));
    firstDispatcher.registerNode(new IncrNode('merge-retained-selected', new ExecutionProbe()));
    firstDispatcher.registerDAG(childADag);
    firstDispatcher.registerDAG(childBDag);
    firstDispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [{ 'dagIri': childAIri }, { 'dagIri': childBIri }];
    const partial = await firstDispatcher.execute(RETAINED_SELECTED_PARENT_DAG_IRI, state, {
      'signal': controller.signal,
    });

    assert.equal(partial.cursor, placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'scatter'));
    assert.equal(firstProbe.count, 1);
    const rawProgress = partial.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(rawProgress !== undefined, 'retained scatter checkpoint should be present');
    const progress = Validator.storedScatterProgress.validate(rawProgress);
    const scatterProgress = progress[placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'scatter')];
    assert.ok(scatterProgress !== undefined, 'scatter checkpoint should include the scatter placement');
    if (scatterProgress.mode === 'bounded') {
      assert.equal(scatterProgress.watermark, 1);
      assert.equal(scatterProgress.aheadAcked.length, 0);
    } else {
      assert.equal(scatterProgress.ackedResults[0]?.selectedDag, childAIri);
    }

    partial.state.items = [{ 'dagIri': childBIri }, { 'dagIri': childBIri }];
    const resumeStore = new InMemoryTopologyStore();
    const resumeDispatcher = new Dagonizer<RoutingState>({
      'executionTopologyStore': resumeStore,
    });
    resumeDispatcher.registerNode(new AbortOnFirstItemNode('incr', resumeProbe, null));
    resumeDispatcher.registerNode(new IncrNode('merge-retained-selected', new ExecutionProbe()));
    resumeDispatcher.registerDAG(childADag);
    resumeDispatcher.registerDAG(childBDag);
    resumeDispatcher.registerDAG(parentDag);

    const resumed = await resumeDispatcher.resume(RETAINED_SELECTED_PARENT_DAG_IRI, partial.state, placementIri(RETAINED_SELECTED_PARENT_DAG_IRI, 'scatter'));

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.equal(resumeProbe.count, 1, 'resume should not re-run the already-acked first item');
    const ownerBaseIri = parentDag.nodes.find((placement) => placement.name === 'scatter')?.['@id'] ?? '';
    const rows = [...DagGraphQueries.selectedDagRows(resumeStore)]
      .sort((a, b) => a.ownerIri.localeCompare(b.ownerIri));
    assert.deepEqual(rows, [
      { 'ownerIri': `${ownerBaseIri}/item/1`, 'dagIri': childBIri },
    ]);
  });

  void it('routes scatter items to error when the item value is not in the candidate set', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const childDag = TestDag.child(SCATTER_CHILD_DAG_IRI, 'scatter-child');

    const parentDag = new DAGBuilder(SCATTER_BAD_DAG_IRI, '1', { 'name': 'scatter-bad' })
      .scatter(placementIri(SCATTER_BAD_DAG_IRI, 'scatter'), 'items', { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': [SCATTER_CHILD_DAG_IRI] } }, {
        'all-success': placementIri(SCATTER_BAD_DAG_IRI, 'end-ok'),
        'partial':     placementIri(SCATTER_BAD_DAG_IRI, 'end-ok'),
        'all-error':   placementIri(SCATTER_BAD_DAG_IRI, 'end-ok'),
        'empty': placementIri(SCATTER_BAD_DAG_IRI, 'end-ok'),
      }, { 'name': 'scatter' })
      .terminal(placementIri(SCATTER_BAD_DAG_IRI, 'end-ok'), { 'name': 'end-ok' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [{ 'dagIri': 'urn:noocodec:dag:no-such-dag' }, { 'dagIri': 'urn:noocodec:dag:no-such-dag' }];
    const result = await dispatcher.execute(SCATTER_BAD_DAG_IRI, state);

    // All items routed to their error output; scatter still reaches its terminal.
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 0, 'no child dag ran');
  });

  void it('runs ten thousand dynamic DAG scatter items with a prepared candidate set', async () => {
    const itemCount = 10000;
    const candidateCount = 1000;
    const store = new InMemoryTopologyStore();
    const candidates: [string, ...string[]] = ['https://example.test/dag/scale-child-0'];
    for (let index = 1; index < candidateCount; index += 1) {
      candidates.push(`https://example.test/dag/scale-child-${index}`);
    }
    const parentDag = new DAGBuilder(SCATTER_SCALE_PARENT_DAG_IRI, '1', { 'name': 'scatter-scale-parent' })
      .scatter(placementIri(SCATTER_SCALE_PARENT_DAG_IRI, 'scatter'), 'items', { 'dag': { 'from': 'item', 'path': 'dagIri', candidates } }, {
        'all-success': placementIri(SCATTER_SCALE_PARENT_DAG_IRI, 'end'),
        'partial':     placementIri(SCATTER_SCALE_PARENT_DAG_IRI, 'end'),
        'all-error':   placementIri(SCATTER_SCALE_PARENT_DAG_IRI, 'end'),
        'empty':       placementIri(SCATTER_SCALE_PARENT_DAG_IRI, 'end'),
      }, {
        'execution': { 'mode': 'item', 'concurrency': 128 },
        'name': 'scatter',
      })
      .terminal(placementIri(SCATTER_SCALE_PARENT_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    for (const candidate of candidates) {
      dispatcher.registerDAG(
        new DAGBuilder(candidate, '1', { 'name': candidate })
          .terminal(placementIri(candidate, 'done'), { 'name': 'done' })
          .entrypoints({ 'main': placementIri(candidate, 'done') })
          .build(),
      );
    }
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = Array.from({ 'length': itemCount }, () => ({ 'dagIri': 'https://example.test/dag/scale-child-0' }));
    const result = await dispatcher.execute(SCATTER_SCALE_PARENT_DAG_IRI, state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.errors.length, 0);
    assert.equal(DagGraphQueries.selectedDagRows(store).length, itemCount);
    assert.deepEqual(DagGraphQueries.selectedDagIris(store), [
      'https://example.test/dag/scale-child-0',
    ]);
  });
});

void describe('DagReferenceResolver', () => {
  void it('asserts selected DAG bindings into a topology store', () => {
    const store = new InMemoryTopologyStore();
    const selectedDagIri = SELECTED_CHILD_DAG_IRI;
    const ownerPlacementIri = 'urn:noocodec:dag:parent/node/invoke';

    DagReferenceResolver.bindSelectedDag({
      store,
      ownerPlacementIri,
      selectedDagIri,
    });

    assert.deepEqual(DagGraphQueries.selectedDagIris(store), [selectedDagIri]);
  });
});

// ── Validator: canonical DagReference shape ───────────────────────────────────
//
// The schema rejects `dagFrom`; dynamic references use `dag: DagReference`.

void describe('DAGValidator: embedded dag reference shape', () => {
  void it('schema rejects a node with dynamic dag reference set', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    // Register a child dag first (the dag:'some-child' reference must resolve);
    // its `run` node references `incr`, so that node must exist too.
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child(SOME_CHILD_DAG_IRI, 'some-child'));

    const bogusRaw: unknown = {
      '@context': DAG_CONTEXT,
      '@id': BOGUS_BOTH_DAG_IRI,
      '@type':    'DAG',
      'name':     'bogus-both',
      'version':  '1',
      'entrypoints': { 'main': placementIri(BOGUS_BOTH_DAG_IRI, 'embed') },
      'nodes': [
        {
          '@id': placementIri(BOGUS_BOTH_DAG_IRI, 'embed'),
          '@type':  'EmbeddedDAGNode',
          'name':   'embed',
          'dag':     SOME_CHILD_DAG_IRI,
          'dagFrom': 'selectedDag',
          'outputs': { 'success': placementIri(BOGUS_BOTH_DAG_IRI, 'end'), 'error': placementIri(BOGUS_BOTH_DAG_IRI, 'end') },
        },
        TestDag.terminal(BOGUS_BOTH_DAG_IRI),
      ],
    };
    assert.throws(() => Validator.dag.validate(bogusRaw));
  });

  void it('registerDAG rejects a node with no dag reference', () => {
    const dispatcher = new Dagonizer<RoutingState>();

    const bogusRaw: unknown = {
      '@context': DAG_CONTEXT,
      '@id': BOGUS_NEITHER_DAG_IRI,
      '@type':    'DAG',
      'name':     'bogus-neither',
      'version':  '1',
      'entrypoints': { 'main': placementIri(BOGUS_NEITHER_DAG_IRI, 'embed') },
      'nodes': [
        {
          '@id': placementIri(BOGUS_NEITHER_DAG_IRI, 'embed'),
          '@type':  'EmbeddedDAGNode',
          'name':   'embed',
          'outputs': { 'success': placementIri(BOGUS_NEITHER_DAG_IRI, 'end'), 'error': placementIri(BOGUS_NEITHER_DAG_IRI, 'end') },
        },
        TestDag.terminal(BOGUS_NEITHER_DAG_IRI),
      ],
    };
    const bogus = Validator.dag.validate(bogusRaw);

    assert.throws(() => dispatcher.registerDAG(bogus));
  });

  void it('registerDAG accepts a node with only dag set', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    const childDag = TestDag.child(VALID_CHILD_LITERAL_DAG_IRI, 'valid-child-literal');

    const parentDag = new DAGBuilder(VALID_LITERAL_DAG_IRI, '1', { 'name': 'valid-literal' })
      .embed(placementIri(VALID_LITERAL_DAG_IRI, 'embed'), VALID_CHILD_LITERAL_DAG_IRI, { 'success': placementIri(VALID_LITERAL_DAG_IRI, 'end'), 'error': placementIri(VALID_LITERAL_DAG_IRI, 'end-fail') }, { 'name': 'embed' })
      .terminal(placementIri(VALID_LITERAL_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(VALID_LITERAL_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    // The child's `run` node references `incr`, so that node must exist.
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(childDag);
    assert.doesNotThrow(() => dispatcher.registerDAG(parentDag));
  });

  void it('registerDAG accepts a node with a dynamic dag reference and registered candidates', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child(VALID_CHILD_DYNAMIC_DAG_IRI, 'valid-child-dynamic'));

    const parentDag = new DAGBuilder(VALID_FROM_ONLY_DAG_IRI, '1', { 'name': 'valid-from-only' })
      .embed(placementIri(VALID_FROM_ONLY_DAG_IRI, 'embed'), { 'from': 'state', 'path': 'selectedDag', 'candidates': [VALID_CHILD_DYNAMIC_DAG_IRI] }, { 'success': placementIri(VALID_FROM_ONLY_DAG_IRI, 'end'), 'error': placementIri(VALID_FROM_ONLY_DAG_IRI, 'end-fail') }, { 'name': 'embed' })
      .terminal(placementIri(VALID_FROM_ONLY_DAG_IRI, 'end'), { 'name': 'end' })
      .terminal(placementIri(VALID_FROM_ONLY_DAG_IRI, 'end-fail'), { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    assert.doesNotThrow(() => dispatcher.registerDAG(parentDag));
  });

  void it('registerDAG rejects an embedded dynamic reference that reads from item', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child(EMBEDDED_MODE_CHILD_DAG_IRI, 'embedded-mode-child'));

    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI,
      '@type': 'DAG',
      'name': 'bad-embedded-reference-mode',
      'version': '1',
      'entrypoints': { 'main': placementIri(BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI, 'embed') },
      'nodes': [
        {
          '@id': placementIri(BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI, 'embed'),
          '@type': 'EmbeddedDAGNode',
          'name': 'embed',
          'dag': { '@type': 'DagReference', 'from': 'item', 'path': 'dagIri', 'candidates': [EMBEDDED_MODE_CHILD_DAG_IRI] },
          'outputs': { 'success': placementIri(BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI, 'end'), 'error': placementIri(BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI, 'end-fail') },
        },
        { '@id': placementIri(BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
        { '@id': placementIri(BAD_EMBEDDED_REFERENCE_MODE_DAG_IRI, 'end-fail'), '@type': 'TerminalNode', 'name': 'end-fail', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(parentDag),
      /EmbeddedDAGNode 'embed': dynamic dag reference must use from='state'/u,
    );
  });

  void it('registerDAG rejects a scatter dynamic reference that reads from state', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child(SCATTER_MODE_CHILD_DAG_IRI, 'scatter-mode-child'));

    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': BAD_SCATTER_REFERENCE_MODE_DAG_IRI,
      '@type': 'DAG',
      'name': 'bad-scatter-reference-mode',
      'version': '1',
      'entrypoints': { 'main': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'scatter') },
      'nodes': [
        {
          '@id': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'scatter'),
          '@type': 'ScatterNode',
          'name': 'scatter',
          'source': 'items',
          'body': { 'dag': { '@type': 'DagReference', 'from': 'state', 'path': 'selectedDag', 'candidates': [SCATTER_MODE_CHILD_DAG_IRI] } },
          'outputs': {
            'all-success': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'end'),
            'partial': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'end'),
            'all-error': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'end-fail'),
            'empty': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'end'),
          },
        },
        { '@id': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'end'), '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
        { '@id': placementIri(BAD_SCATTER_REFERENCE_MODE_DAG_IRI, 'end-fail'), '@type': 'TerminalNode', 'name': 'end-fail', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(parentDag),
      /ScatterNode 'scatter': dynamic dag reference must use from='item'/u,
    );
  });
});
