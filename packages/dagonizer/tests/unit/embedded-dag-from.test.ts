/**
 * Tests for runtime DagReference resolution.
 *
 * `EmbeddedDAGNode` and `ScatterNode` can read the dag name from a dotted
 * state or item path at execution time in addition to build-time literal
 * DAG references. An empty or non-candidate dag name routes to the placement's
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
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/dag/DAG.js';
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

class RoutingState extends NodeStateBase {
  /** The dag name placed here by a setup node and read by the dynamic embed reference. */
  selectedDag = '';
  /** Execution counter threaded through the cardinality-1 embed via state mapping. */
  executed = 0;
  /** Scatter items: each names its own body dag. */
  items: Array<{ dagName: string }> = [{ 'dagName': 'scatter-child' }, { 'dagName': 'scatter-child' }];
}

/** Increments `state.executed` (for state round-trip) and the shared probe. */
class IncrNode extends MonadicNode<RoutingState, 'success' | 'error'> {
  readonly name: string;
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } }; }
  readonly #probe: ExecutionProbe;

  constructor(name: string, probe: ExecutionProbe) {
    super();
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
  readonly name: string;
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
  readonly #probe: ExecutionProbe;
  readonly #controller: AbortController | null;

  constructor(name: string, probe: ExecutionProbe, controller: AbortController | null) {
    super();
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
  readonly name: string;
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }
  readonly #dagName: string;

  constructor(name: string, dagName: string) {
    super();
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

/** DAG-shaped fixtures: terminals and a minimal child DAG. */
class TestDag {
  private constructor() { /* static-only */ }

  static terminal(dagName: string): DAGType['nodes'][number] {
    return {
      '@id':     `urn:noocodex:dag:${dagName}/node/end`,
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    };
  }

  static failedTerminal(dagName: string): DAGType['nodes'][number] {
    return {
      '@id':     `urn:noocodex:dag:${dagName}/node/end-fail`,
      '@type':   'TerminalNode',
      'name':    'end-fail',
      'outcome': 'failed',
    };
  }

  /** A minimal 1-node child DAG that runs the `incr` node. */
  static child(name: string): DAGType {
    return TestDag.childWithNode(name, 'incr');
  }

  static childWithNode(name: string, nodeName: string): DAGType {
    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${name}`,
      '@type':    'DAG',
      'name':     name,
      'version':  '1',
      'entrypoints': { 'main': 'run' },
      'nodes': [
        {
          '@id':   `urn:noocodex:dag:${name}/node/run`,
          '@type': 'SingleNode',
          'name':  'run',
          'node':  nodeName,
          'outputs': { 'success': 'end', 'error': 'end-fail' },
        },
        TestDag.terminal(name),
        TestDag.failedTerminal(name),
      ],
    };
  }
}

// ── EmbeddedDAGNode DagReference tests ────────────────────────────────────────

void describe('EmbeddedDAGNode: DagReference runtime resolution', () => {
  void it('resolves the dag name from a state path and executes the child dag', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const setNode = new SetDagNode('set-dag', 'child-a');
    const childDag = TestDag.child('child-a');

    const parentDag = new DAGBuilder('parent', '1')
      .node('set-dag', setNode, { 'success': 'invoke' })
      .embeddedDAG<RoutingState, RoutingState>('invoke', { 'from': 'state', 'path': 'selectedDag', 'candidates': ['child-a'] }, { 'success': 'end', 'error': 'end-fail' }, {
        'inputs':  { 'executed': 'executed' },
        'outputs': { 'executed': 'executed' },
      })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerNode(setNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute('parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 1, 'child dag should have executed once');
    assert.equal(state.executed, 1, 'child increment maps back into parent state');
  });

  void it('resolves an expanded DAG IRI from a state path and executes the declared candidate', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const setNode = new SetDagNode('set-dag', 'https://noocodex.dev/dag/default#child-expanded');
    const childDag = TestDag.child('child-expanded');
    const store = new InMemoryTopologyStore();

    const parentDag = new DAGBuilder('parent-expanded', '1')
      .node('set-dag', setNode, { 'success': 'invoke' })
      .embeddedDAG<RoutingState, RoutingState>('invoke', { 'from': 'state', 'path': 'selectedDag', 'candidates': ['child-expanded'] }, { 'success': 'end', 'error': 'end-fail' }, {
        'inputs':  { 'executed': 'executed' },
        'outputs': { 'executed': 'executed' },
      })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    dispatcher.registerNode(incrNode);
    dispatcher.registerNode(setNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute('parent-expanded', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 1);
    assert.equal(state.executed, 1);
    assert.deepEqual(
      DagGraphQueries.selectedDagRows(store),
      [{
        'ownerIri': DagGraphProjector.placementIri(DagGraphProjector.dagIri(parentDag), 'invoke'),
        'dagIri':   DagGraphProjector.dagIri(childDag),
      }],
    );
  });

  void it('partitions converged multi-entry batches by each state dynamic dag selection', async () => {
    const probeA = new ExecutionProbe();
    const probeB = new ExecutionProbe();
    const childADag = TestDag.childWithNode('multi-entry-child-a', 'incr-a');
    const childBDag = TestDag.childWithNode('multi-entry-child-b', 'incr-b');
    const store = new InMemoryTopologyStore();

    const parentDag = new DAGBuilder('multi-entry-embedded-parent', '1')
      .entrypoints({ 'alpha': 'set-a', 'beta': 'set-b' })
      .node('set-a', new SetDagNode('set-a', 'multi-entry-child-a'), { 'success': 'invoke' })
      .node('set-b', new SetDagNode('set-b', 'multi-entry-child-b'), { 'success': 'invoke' })
      .embeddedDAG<RoutingState, RoutingState>('invoke', {
        'from': 'state',
        'path': 'selectedDag',
        'candidates': ['multi-entry-child-a', 'multi-entry-child-b'],
      }, { 'success': 'end', 'error': 'end-fail' }, {
        'inputs':  { 'executed': 'executed' },
        'outputs': { 'executed': 'executed' },
      })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    dispatcher.registerNode(new IncrNode('incr-a', probeA));
    dispatcher.registerNode(new IncrNode('incr-b', probeB));
    dispatcher.registerNode(new SetDagNode('set-a', 'multi-entry-child-a'));
    dispatcher.registerNode(new SetDagNode('set-b', 'multi-entry-child-b'));
    dispatcher.registerDAG(childADag);
    dispatcher.registerDAG(childBDag);
    dispatcher.registerDAG(parentDag);

    const result = await dispatcher.execute('multi-entry-embedded-parent', new RoutingState());

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probeA.count, 1);
    assert.equal(probeB.count, 1);
    const ownerBaseIri = DagGraphProjector.placementIri(DagGraphProjector.dagIri(parentDag), 'invoke');
    assert.deepEqual(
      [...DagGraphQueries.selectedDagRows(store)].sort((a, b) => a.ownerIri.localeCompare(b.ownerIri)),
      [
        { 'ownerIri': `${ownerBaseIri}/item/alpha`, 'dagIri': DagGraphProjector.dagIri(childADag) },
        { 'ownerIri': `${ownerBaseIri}/item/beta`, 'dagIri': DagGraphProjector.dagIri(childBDag) },
      ],
    );
  });

  void it('routes to error when the state value is not in the candidate set', async () => {
    const setNode = new SetDagNode('set-dag', 'does-not-exist');
    const childDag = TestDag.child('child-a');

    const parentDag = new DAGBuilder('parent-missing', '1')
      .node('set-dag', setNode, { 'success': 'invoke' })
      .embeddedDAG('invoke', { 'from': 'state', 'path': 'selectedDag', 'candidates': ['child-a'] }, { 'success': 'end-ok', 'error': 'end-fail' })
      .terminal('end-ok')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(setNode);
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    const result = await dispatcher.execute('parent-missing', state);

    assert.equal(result.terminalOutcome, 'failed', 'non-candidate dag → error output → failed terminal');
  });

  void it('routes to error when dynamic reference path resolves to an empty string', async () => {
    // selectedDag starts as '' — an empty string is not a valid dag name.
    const parentDag = new DAGBuilder('parent-empty', '1')
      .embeddedDAG('invoke', { 'from': 'state', 'path': 'selectedDag', 'candidates': ['child-a'] }, { 'success': 'end-ok', 'error': 'end-fail' })
      .terminal('end-ok')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child('child-a'));
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState(); // selectedDag === ''
    const result = await dispatcher.execute('parent-empty', state);

    assert.equal(result.terminalOutcome, 'failed');
  });
});

// ── ScatterNode DagReference tests ────────────────────────────────────────────

void describe('ScatterNode: DagReference runtime resolution', () => {
  void it('resolves each item dag name from clone state and runs the sub-dag per item', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const childDag = TestDag.child('scatter-child');

    // Each scatter item names its own body dag from the item directly.
    const parentDag = new DAGBuilder('scatter-parent', '1')
      .scatter('scatter', 'items', { 'dag': { 'from': 'item', 'path': 'dagName', 'candidates': ['scatter-child'] } }, {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [{ 'dagName': 'scatter-child' }, { 'dagName': 'scatter-child' }, { 'dagName': 'scatter-child' }];
    const result = await dispatcher.execute('scatter-parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 3, 'child dag should run once per item');
  });

  void it('resolves expanded DAG IRIs from scatter items and runs the declared candidate', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const childDag = TestDag.child('scatter-expanded-child');
    const store = new InMemoryTopologyStore();

    const parentDag = new DAGBuilder('scatter-expanded-parent', '1')
      .scatter('scatter', 'items', { 'dag': { 'from': 'item', 'path': 'dagName', 'candidates': ['scatter-expanded-child'] } }, {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [
      { 'dagName': 'https://noocodex.dev/dag/default#scatter-expanded-child' },
      { 'dagName': 'https://noocodex.dev/dag/default#scatter-expanded-child' },
    ];
    const result = await dispatcher.execute('scatter-expanded-parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 2);
    const ownerBaseIri = DagGraphProjector.placementIri(DagGraphProjector.dagIri(parentDag), 'scatter');
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
    const childADag = TestDag.child('retained-selected-child-a');
    const childBDag = TestDag.child('retained-selected-child-b');
    const parentDag = new DAGBuilder('retained-selected-parent', '1')
      .scatter('scatter', 'items', { 'dag': { 'from': 'item', 'path': 'dagName', 'candidates': ['retained-selected-child-a', 'retained-selected-child-b'] } }, {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      }, {
        'gather': { 'strategy': 'custom', 'customNode': 'merge-retained-selected' },
        'execution': { 'mode': 'item', 'concurrency': 1 },
      })
      .terminal('end')
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
    state.items = [{ 'dagName': childAIri }, { 'dagName': childBIri }];
    const partial = await firstDispatcher.execute('retained-selected-parent', state, {
      'signal': controller.signal,
    });

    assert.equal(partial.cursor, 'scatter');
    assert.equal(firstProbe.count, 1);
    const rawProgress = partial.state.getMetadata(SCATTER_PROGRESS_KEY);
    assert.ok(rawProgress !== undefined, 'retained scatter checkpoint should be present');
    const progress = Validator.storedScatterProgress.validate(rawProgress);
    const scatterProgress = progress['scatter'];
    assert.equal(scatterProgress?.mode, 'retained');
    assert.equal(scatterProgress.ackedResults[0]?.selectedDag, childAIri);

    partial.state.items = [{ 'dagName': childBIri }, { 'dagName': childBIri }];
    const resumeStore = new InMemoryTopologyStore();
    const resumeDispatcher = new Dagonizer<RoutingState>({
      'executionTopologyStore': resumeStore,
    });
    resumeDispatcher.registerNode(new AbortOnFirstItemNode('incr', resumeProbe, null));
    resumeDispatcher.registerNode(new IncrNode('merge-retained-selected', new ExecutionProbe()));
    resumeDispatcher.registerDAG(childADag);
    resumeDispatcher.registerDAG(childBDag);
    resumeDispatcher.registerDAG(parentDag);

    const resumed = await resumeDispatcher.resume('retained-selected-parent', partial.state, 'scatter');

    assert.equal(resumed.terminalOutcome, 'completed');
    assert.equal(resumeProbe.count, 1, 'resume should not re-run the already-acked first item');
    const ownerBaseIri = DagGraphProjector.placementIri(DagGraphProjector.dagIri(parentDag), 'scatter');
    const rows = [...DagGraphQueries.selectedDagRows(resumeStore)]
      .sort((a, b) => a.ownerIri.localeCompare(b.ownerIri));
    assert.deepEqual(rows, [
      { 'ownerIri': `${ownerBaseIri}/item/0`, 'dagIri': childAIri },
      { 'ownerIri': `${ownerBaseIri}/item/1`, 'dagIri': childBIri },
    ]);
  });

  void it('routes scatter items to error when the item value is not in the candidate set', async () => {
    const probe = new ExecutionProbe();
    const incrNode = new IncrNode('incr', probe);
    const childDag = TestDag.child('scatter-child');

    const parentDag = new DAGBuilder('scatter-bad', '1')
      .scatter('scatter', 'items', { 'dag': { 'from': 'item', 'path': 'dagName', 'candidates': ['scatter-child'] } }, {
        'all-success': 'end-ok',
        'partial':     'end-ok',
        'all-error':   'end-ok',
        'empty':       'end-ok',
      }, {
        'gather': { 'strategy': 'discard' },
      })
      .terminal('end-ok')
      .build();

    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(incrNode);
    dispatcher.registerDAG(childDag);
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = [{ 'dagName': 'no-such-dag' }, { 'dagName': 'no-such-dag' }];
    const result = await dispatcher.execute('scatter-bad', state);

    // All items routed to their error output; scatter still reaches its terminal.
    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(probe.count, 0, 'no child dag ran');
  });

  void it('runs ten thousand dynamic DAG scatter items with a prepared candidate set', async () => {
    const itemCount = 10000;
    const candidateCount = 1000;
    const store = new InMemoryTopologyStore();
    const candidates: [string, ...string[]] = ['scale-child-0'];
    for (let index = 1; index < candidateCount; index += 1) {
      candidates.push(`scale-child-${index}`);
    }
    const parentDag = new DAGBuilder('scatter-scale-parent', '1')
      .scatter('scatter', 'items', { 'dag': { 'from': 'item', 'path': 'dagName', candidates } }, {
        'all-success': 'end',
        'partial':     'end',
        'all-error':   'end',
        'empty':       'end',
      }, {
        'gather':    { 'strategy': 'discard' },
        'execution': { 'mode': 'item', 'concurrency': 128 },
      })
      .terminal('end')
      .build();

    const dispatcher = new Dagonizer<RoutingState>({ 'executionTopologyStore': store });
    for (const candidate of candidates) {
      dispatcher.registerDAG(new DAGBuilder(candidate, '1').terminal('done').build());
    }
    dispatcher.registerDAG(parentDag);

    const state = new RoutingState();
    state.items = Array.from({ 'length': itemCount }, () => ({ 'dagName': 'scale-child-0' }));
    const result = await dispatcher.execute('scatter-scale-parent', state);

    assert.equal(result.terminalOutcome, 'completed');
    assert.equal(result.state.errors.length, 0);
    assert.equal(DagGraphQueries.selectedDagRows(store).length, itemCount);
    assert.deepEqual(DagGraphQueries.selectedDagIris(store), [
      'https://noocodex.dev/dag/default#scale-child-0',
    ]);
  });
});

void describe('DagReferenceResolver', () => {
  void it('asserts selected DAG bindings into a topology store', () => {
    const store = new InMemoryTopologyStore();
    const selectedDagIri = 'https://noocodex.dev/dag/default#selected-child';
    const ownerPlacementIri = DagGraphProjector.placementIri('https://noocodex.dev/dag/default#parent', 'invoke');

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
  void it('schema rejects a node with legacy dagFrom set', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    // Register a child dag first (the dag:'some-child' reference must resolve);
    // its `run` node references `incr`, so that node must exist too.
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child('some-child'));

    const bogusRaw: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:bogus-both',
      '@type':    'DAG',
      'name':     'bogus-both',
      'version':  '1',
      'entrypoints': { 'main': 'embed' },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:bogus-both/node/embed',
          '@type':  'EmbeddedDAGNode',
          'name':   'embed',
          'dag':     'some-child',
          'dagFrom': 'selectedDag',
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        TestDag.terminal('bogus-both'),
      ],
    };
    assert.throws(() => Validator.dag.validate(bogusRaw));
  });

  void it('registerDAG rejects a node with no dag reference', () => {
    const dispatcher = new Dagonizer<RoutingState>();

    const bogusRaw: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:bogus-neither',
      '@type':    'DAG',
      'name':     'bogus-neither',
      'version':  '1',
      'entrypoints': { 'main': 'embed' },
      'nodes': [
        {
          '@id':    'urn:noocodex:dag:bogus-neither/node/embed',
          '@type':  'EmbeddedDAGNode',
          'name':   'embed',
          'outputs': { 'success': 'end', 'error': 'end' },
        },
        TestDag.terminal('bogus-neither'),
      ],
    };
    const bogus = Validator.dag.validate(bogusRaw);

    assert.throws(() => dispatcher.registerDAG(bogus));
  });

  void it('registerDAG accepts a node with only dag set', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    const childDag = TestDag.child('valid-child-literal');

    const parentDag = new DAGBuilder('valid-literal', '1')
      .embeddedDAG('embed', 'valid-child-literal', { 'success': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    // The child's `run` node references `incr`, so that node must exist.
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(childDag);
    assert.doesNotThrow(() => dispatcher.registerDAG(parentDag));
  });

  void it('registerDAG accepts a node with a dynamic dag reference and registered candidates', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child('valid-child-dynamic'));

    const parentDag = new DAGBuilder('valid-from-only', '1')
      .embeddedDAG('embed', { 'from': 'state', 'path': 'selectedDag', 'candidates': ['valid-child-dynamic'] }, { 'success': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    assert.doesNotThrow(() => dispatcher.registerDAG(parentDag));
  });

  void it('registerDAG rejects an embedded dynamic reference that reads from item', () => {
    const dispatcher = new Dagonizer<RoutingState>();
    dispatcher.registerNode(new IncrNode('incr', new ExecutionProbe()));
    dispatcher.registerDAG(TestDag.child('embedded-mode-child'));

    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:bad-embedded-reference-mode',
      '@type': 'DAG',
      'name': 'bad-embedded-reference-mode',
      'version': '1',
      'entrypoints': { 'main': 'embed' },
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:bad-embedded-reference-mode/node/embed',
          '@type': 'EmbeddedDAGNode',
          'name': 'embed',
          'dag': { '@type': 'DagReference', 'from': 'item', 'path': 'dagName', 'candidates': ['embedded-mode-child'] },
          'outputs': { 'success': 'end', 'error': 'end-fail' },
        },
        { '@id': 'urn:noocodex:dag:bad-embedded-reference-mode/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:bad-embedded-reference-mode/node/end-fail', '@type': 'TerminalNode', 'name': 'end-fail', 'outcome': 'failed' },
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
    dispatcher.registerDAG(TestDag.child('scatter-mode-child'));

    const parentDag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': 'urn:noocodex:dag:bad-scatter-reference-mode',
      '@type': 'DAG',
      'name': 'bad-scatter-reference-mode',
      'version': '1',
      'entrypoints': { 'main': 'scatter' },
      'nodes': [
        {
          '@id': 'urn:noocodex:dag:bad-scatter-reference-mode/node/scatter',
          '@type': 'ScatterNode',
          'name': 'scatter',
          'source': 'items',
          'body': { 'dag': { '@type': 'DagReference', 'from': 'state', 'path': 'selectedDag', 'candidates': ['scatter-mode-child'] } },
          'gather': { 'strategy': 'discard' },
          'outputs': {
            'all-success': 'end',
            'partial': 'end',
            'all-error': 'end-fail',
            'empty': 'end',
          },
        },
        { '@id': 'urn:noocodex:dag:bad-scatter-reference-mode/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' },
        { '@id': 'urn:noocodex:dag:bad-scatter-reference-mode/node/end-fail', '@type': 'TerminalNode', 'name': 'end-fail', 'outcome': 'failed' },
      ],
    };

    assert.throws(
      () => dispatcher.registerDAG(parentDag),
      /ScatterNode 'scatter': dynamic dag reference must use from='item'/u,
    );
  });
});
