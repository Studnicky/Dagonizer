import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/index.js';
import type { SchemaObjectType, NodeInterface  } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import { Timeout } from '../../src/entities/Timeout.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { Validator } from '../../src/validation/Validator.js';
import { TestDag } from '../_support/TestDag.js';
import { TestNode } from '../_support/TestNode.js';

// ── Helpers ───────────────────────────────────────────────────────────────

class TrackingState extends NodeStateBase {
  trace: string[] = [];
}

class PhaseThrowingNode extends MonadicNode<TrackingState, string> {
  readonly '@id': string;
  readonly name: string;
  readonly outputs: readonly ['success'] = ['success'];
  private readonly message: string;

  constructor(name: string, message: string) {
    super();
    this['@id'] = `urn:noocodec:node:${encodeURIComponent(name)}`;
    this.name = name;
    this.message = message;
  }

  override get outputSchema(): Record<string, SchemaObjectType> { return { 'success': { 'type': 'object' } }; }

  override async execute(_batch: Batch<TrackingState>): Promise<RoutedBatchType<string, TrackingState>> {
    throw new Error(this.message);
  }
}

class TestPhaseNode {
  private constructor() { /* static class */ }

  private static iri(name: string): string {
    return `urn:noocodec:node:${encodeURIComponent(name)}`;
  }

  static of(
    name: string,
    outputs: readonly string[] = ['success'],
    side?: (state: TrackingState) => void | Promise<void>,
  ): NodeInterface<TrackingState> {
    if (side !== undefined) {
      return TestNode.make<TrackingState>(TestPhaseNode.iri(name), outputs, async (state) => {
        await side(state);
        const first = outputs[0];
        if (first === undefined) throw new Error('outputs must be non-empty');
        return first;
      });
    }
    return TestNode.make<TrackingState>(TestPhaseNode.iri(name), outputs, (state) => {
      state.trace.push(name);
      const first = outputs[0];
      if (first === undefined) throw new Error('outputs must be non-empty');
      return first;
    });
  }
}

class TestThrowingNode {
  private constructor() { /* static class */ }
  static of(name: string, message: string): PhaseThrowingNode {
    return new PhaseThrowingNode(name, message);
  }
}

// Recording Dagonizer subclass captures phase hook invocations in order.
type Call = {
  readonly hook: string;
  readonly args: readonly unknown[];
}

const placementIri = TestDag.placementIri;
const DEMO_DAG_IRI = 'urn:noocodec:dag:demo';
const PRE_RUNS_FIRST_DAG_IRI = 'urn:noocodec:dag:pre-runs-first';
const PRE_ABORTS_DAG_IRI = 'urn:noocodec:dag:pre-aborts';
const MULTI_PRE_DAG_IRI = 'urn:noocodec:dag:multi-pre';
const POST_SUCCESS_DAG_IRI = 'urn:noocodec:dag:post-success';
const POST_ABORT_DAG_IRI = 'urn:noocodec:dag:post-abort';
const POST_THROWS_DAG_IRI = 'urn:noocodec:dag:post-throws';
const MULTI_POST_DAG_IRI = 'urn:noocodec:dag:multi-post';
const INSTR_PHASES_DAG_IRI = 'urn:noocodec:dag:instr-phases';
const ORDERING_DAG_IRI = 'urn:noocodec:dag:ordering';
const BAD_PHASE_DAG_IRI = 'urn:noocodec:dag:bad-phase';

class RecordingDagonizer extends Dagonizer<TrackingState> {
  readonly calls: Call[] = [];

  protected override onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TrackingState, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'phaseEnter', 'args': [dagName, phase, placementName, state, placementPath] });
  }
  protected override onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TrackingState, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'phaseExit', 'args': [dagName, phase, placementName, state, placementPath] });
  }
  protected override onFlowStart(dagName: string, state: TrackingState): void {
    this.calls.push({ 'hook': 'flowStart', 'args': [dagName, state] });
  }
  protected override onFlowEnd(dagName: string, _state: TrackingState): void {
    this.calls.push({ 'hook': 'flowEnd', 'args': [dagName] });
  }

  hooksOfType(hookName: string): Call[] {
    return this.calls.filter((call) => call.hook === hookName);
  }
}

// ── 1. Schema validation ──────────────────────────────────────────────────

void describe('PhaseNode placements: schema validation', () => {
  void it('accepts a valid pre-phase placement', () => {
    const valid = {
      '@id': 'urn:noocodec:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'urn:noocodec:node:setup-node',
      'phase': 'pre',
    };
    assert.equal(Validator.phaseNode.is(valid), true);
  });

  void it('accepts a valid post-phase placement', () => {
    const valid = {
      '@id': 'urn:noocodec:dag:demo/node/teardown',
      '@type': 'PhaseNode',
      'name':  'teardown',
      'node':  'urn:noocodec:node:teardown-node',
      'phase': 'post',
    };
    assert.equal(Validator.phaseNode.is(valid), true);
  });

  void it('rejects a PhaseNode missing phase field', () => {
    const bad = {
      '@id': 'urn:noocodec:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'urn:noocodec:node:setup-node',
    };
    assert.equal(Validator.phaseNode.is(bad), false);
  });

  void it('rejects phase=mid (not in enum)', () => {
    const bad = {
      '@id': 'urn:noocodec:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'urn:noocodec:node:setup-node',
      'phase': 'mid',
    };
    assert.equal(Validator.phaseNode.is(bad), false);
  });

  void it('rejects an extra outputs field (additionalProperties: false)', () => {
    const bad = {
      '@id': 'urn:noocodec:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'urn:noocodec:node:setup-node',
      'phase': 'pre',
      'outputs': { 'success': placementIri(DEMO_DAG_IRI, 'end') },
    };
    assert.equal(Validator.phaseNode.is(bad), false);
  });

  void it('PhaseNode passes Validator.dag.is() when embedded in a DAG', () => {
    const dag: unknown = {
      '@context': DAG_CONTEXT,
      '@id': DEMO_DAG_IRI,
      '@type':    'DAG',
      'name':       'demo',
      'version':    '1',
      'entrypoints': { 'main': placementIri(DEMO_DAG_IRI, 'a') },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:demo/node/setup',
          '@type': 'PhaseNode',
          'name':  'setup',
          'node':  'urn:noocodec:node:setup-node',
          'phase': 'pre',
        },
        {
          '@id': 'urn:noocodec:dag:demo/node/a',
          '@type': 'SingleNode',
          'name':  'a',
          'node':  'urn:noocodec:node:a',
          'outputs': { 'success': placementIri(DEMO_DAG_IRI, 'end') },
        },
        { '@id': 'urn:noocodec:dag:demo/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    assert.equal(Validator.dag.is(dag), true);
  });
});

// ── 2. Pre-phase execution ────────────────────────────────────────────────

void describe('PhaseNode placements: pre-phase execution', () => {
  void it('pre-phase runs before the entrypoint and its mutations are visible to the entrypoint', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('setup-node', ['success'], (state) => {
      state.trace.push('pre-setup');
    }));
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));

    const dag = new DAGBuilder(PRE_RUNS_FIRST_DAG_IRI, '1', { 'name': 'pre-runs-first' })
      .node(placementIri(PRE_RUNS_FIRST_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(PRE_RUNS_FIRST_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(PRE_RUNS_FIRST_DAG_IRI, 'setup'), 'pre', TestPhaseNode.of('setup-node', ['success']), { 'name': 'setup' })
      .terminal(placementIri(PRE_RUNS_FIRST_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(PRE_RUNS_FIRST_DAG_IRI, new TrackingState());
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.deepEqual(result.state.trace, ['pre-setup', 'entry']);
  });

  void it('pre-phase throw aborts the run; lifecycle is failed and main loop never executes', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestThrowingNode.of('boom-pre', 'pre-phase fail'));
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));

    const dag = new DAGBuilder(PRE_ABORTS_DAG_IRI, '1', { 'name': 'pre-aborts' })
      .node(placementIri(PRE_ABORTS_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(PRE_ABORTS_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(PRE_ABORTS_DAG_IRI, 'boom'), 'pre', TestThrowingNode.of('boom-pre', 'pre-phase fail'), { 'name': 'boom' })
      .terminal(placementIri(PRE_ABORTS_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const state = new TrackingState();
    const result = await dispatcher.execute(PRE_ABORTS_DAG_IRI, state);
    assert.equal(result.state.lifecycle.variant, 'failed');
    assert.equal(state.trace.includes('entry'), false, 'entrypoint must not run');
  });

  void it('multiple pre-phases run in declaration order', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('p1', ['success'], (s) => { s.trace.push('p1'); }));
    dispatcher.registerNode(TestPhaseNode.of('p2', ['success'], (s) => { s.trace.push('p2'); }));
    dispatcher.registerNode(TestPhaseNode.of('p3', ['success'], (s) => { s.trace.push('p3'); }));
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));

    const dag = new DAGBuilder(MULTI_PRE_DAG_IRI, '1', { 'name': 'multi-pre' })
      .node(placementIri(MULTI_PRE_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(MULTI_PRE_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(MULTI_PRE_DAG_IRI, 'p1'), 'pre', TestPhaseNode.of('p1', ['success']), { 'name': 'p1' })
      .phase(placementIri(MULTI_PRE_DAG_IRI, 'p2'), 'pre', TestPhaseNode.of('p2', ['success']), { 'name': 'p2' })
      .phase(placementIri(MULTI_PRE_DAG_IRI, 'p3'), 'pre', TestPhaseNode.of('p3', ['success']), { 'name': 'p3' })
      .terminal(placementIri(MULTI_PRE_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(MULTI_PRE_DAG_IRI, new TrackingState());
    assert.deepEqual(result.state.trace, ['p1', 'p2', 'p3', 'entry']);
  });
});

// ── 3. Post-phase execution ───────────────────────────────────────────────

void describe('PhaseNode placements: post-phase execution', () => {
  void it('post-phase runs after the main loop on the success path', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));
    dispatcher.registerNode(TestPhaseNode.of('teardown', ['success'], (s) => { s.trace.push('post-teardown'); }));

    const dag = new DAGBuilder(POST_SUCCESS_DAG_IRI, '1', { 'name': 'post-success' })
      .node(placementIri(POST_SUCCESS_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(POST_SUCCESS_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(POST_SUCCESS_DAG_IRI, 'teardown'), 'post', TestPhaseNode.of('teardown', ['success']), { 'name': 'teardown' })
      .terminal(placementIri(POST_SUCCESS_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(POST_SUCCESS_DAG_IRI, new TrackingState());
    assert.equal(result.state.lifecycle.variant, 'completed');
    assert.deepEqual(result.state.trace, ['entry', 'post-teardown']);
  });

  void it('post-phase runs after the main loop on the abort path', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('teardown', ['success'], (s) => { s.trace.push('post-teardown'); }));

    // Slow node that signals readiness once suspended, then waits for abort.
    // Using a readiness promise avoids any wall-clock dependency.
    let resolveNodeReady!: () => void;
    const nodeReady = new Promise<void>((r) => { resolveNodeReady = r; });

    dispatcher.registerNode({
      '@id': 'urn:noocodec:node:slow',
      'name': 'slow',
      'outputs': ['success'] as const,
      'timeout': Timeout.none(),
      'inputSchema': { 'type': 'object' as const },
      'outputSchema': { 'success': { 'type': 'object' as const } },
      async execute(batch: Batch<TrackingState>, ctx): Promise<RoutedBatchType<'success', TrackingState>> {
        const acc = new Map<'success', ItemType<TrackingState>[]>();
        for (const item of batch) {
          resolveNodeReady();
          await new Promise<void>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => {
              reject(new Error('aborted'));
            }, { 'once': true });
          });
          const bucket = acc.get('success');
          if (bucket !== undefined) { bucket.push(item); } else { acc.set('success', [item]); }
        }
        const routed = new Map<'success', Batch<TrackingState>>();
        for (const [key, items] of acc) { routed.set(key, Batch.from(items)); }
        return routed;
      },
    });

    const dag = new DAGBuilder(POST_ABORT_DAG_IRI, '1', { 'name': 'post-abort' })
      .node(placementIri(POST_ABORT_DAG_IRI, 'slow'), TestPhaseNode.of('slow', ['success']), { 'success': placementIri(POST_ABORT_DAG_IRI, 'end') }, { 'name': 'slow' })
      .phase(placementIri(POST_ABORT_DAG_IRI, 'teardown'), 'post', TestPhaseNode.of('teardown', ['success']), { 'name': 'teardown' })
      .terminal(placementIri(POST_ABORT_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const controller = new AbortController();
    const state = new TrackingState();
    const exec = dispatcher.execute(POST_ABORT_DAG_IRI, state, { 'signal': controller.signal });
    // Abort deterministically once the node body is provably suspended.
    nodeReady.then(() => { controller.abort(); });
    const result = await exec;
    assert.equal(['cancelled', 'failed'].includes(result.state.lifecycle.variant), true);
    assert.ok(state.trace.includes('post-teardown'), 'post-phase ran on abort path');
  });

  void it('post-phase throw collects a warning; lifecycle is unchanged', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));
    dispatcher.registerNode(TestThrowingNode.of('boom-post', 'post-phase fail'));

    const dag = new DAGBuilder(POST_THROWS_DAG_IRI, '1', { 'name': 'post-throws' })
      .node(placementIri(POST_THROWS_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(POST_THROWS_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(POST_THROWS_DAG_IRI, 'boom'), 'post', TestThrowingNode.of('boom-post', 'post-phase fail'), { 'name': 'boom' })
      .terminal(placementIri(POST_THROWS_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(POST_THROWS_DAG_IRI, new TrackingState());
    assert.equal(result.state.lifecycle.variant, 'completed', 'lifecycle is unchanged');
    const warnings = result.state.warnings;
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'POST_PHASE_FAILED');
    assert.equal(warnings[0]?.operation, 'boom');
  });

  void it('multiple post-phases run in declaration order', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));
    dispatcher.registerNode(TestPhaseNode.of('p1', ['success'], (s) => { s.trace.push('p1'); }));
    dispatcher.registerNode(TestPhaseNode.of('p2', ['success'], (s) => { s.trace.push('p2'); }));
    dispatcher.registerNode(TestPhaseNode.of('p3', ['success'], (s) => { s.trace.push('p3'); }));

    const dag = new DAGBuilder(MULTI_POST_DAG_IRI, '1', { 'name': 'multi-post' })
      .node(placementIri(MULTI_POST_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(MULTI_POST_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(MULTI_POST_DAG_IRI, 'p1'), 'post', TestPhaseNode.of('p1', ['success']), { 'name': 'p1' })
      .phase(placementIri(MULTI_POST_DAG_IRI, 'p2'), 'post', TestPhaseNode.of('p2', ['success']), { 'name': 'p2' })
      .phase(placementIri(MULTI_POST_DAG_IRI, 'p3'), 'post', TestPhaseNode.of('p3', ['success']), { 'name': 'p3' })
      .terminal(placementIri(MULTI_POST_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(MULTI_POST_DAG_IRI, new TrackingState());
    assert.deepEqual(result.state.trace, ['entry', 'p1', 'p2', 'p3']);
  });
});

// ── 4. Subclass phase hooks ───────────────────────────────────────────────

void describe('PhaseNode placements: subclass phase hooks', () => {
  void it('onPhaseEnter / onPhaseExit fire with correct phase + placement name', async () => {
    const dispatcher = new RecordingDagonizer();

    dispatcher.registerNode(TestPhaseNode.of('setup', ['success']));
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));
    dispatcher.registerNode(TestPhaseNode.of('teardown', ['success']));

    const dag = new DAGBuilder(INSTR_PHASES_DAG_IRI, '1', { 'name': 'instr-phases' })
      .node(placementIri(INSTR_PHASES_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(INSTR_PHASES_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(INSTR_PHASES_DAG_IRI, 'setup'), 'pre', TestPhaseNode.of('setup', ['success']), { 'name': 'setup' })
      .phase(placementIri(INSTR_PHASES_DAG_IRI, 'teardown'), 'post', TestPhaseNode.of('teardown', ['success']), { 'name': 'teardown' })
      .terminal(placementIri(INSTR_PHASES_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);
    await dispatcher.execute(INSTR_PHASES_DAG_IRI, new TrackingState());

    const enters = dispatcher.hooksOfType('phaseEnter');
    const exits  = dispatcher.hooksOfType('phaseExit');

    assert.equal(enters.length, 2);
    assert.equal(exits.length, 2);

    assert.equal(enters[0]?.args[1], 'pre');
    assert.equal(enters[0]?.args[2], 'setup');
    assert.equal(exits[0]?.args[1], 'pre');
    assert.equal(exits[0]?.args[2], 'setup');

    assert.equal(enters[1]?.args[1], 'post');
    assert.equal(enters[1]?.args[2], 'teardown');
    assert.equal(exits[1]?.args[1], 'post');
    assert.equal(exits[1]?.args[2], 'teardown');
  });
});

// ── 5. executedNodes ordering ────────────────────────────────────────────

void describe('PhaseNode placements: executedNodes ordering', () => {
  void it('executedNodes includes pre-phase names at the start and post-phase names at the end', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('setup', ['success']));
    dispatcher.registerNode(TestPhaseNode.of('teardown', ['success']));
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));

    const dag = new DAGBuilder(ORDERING_DAG_IRI, '1', { 'name': 'ordering' })
      .node(placementIri(ORDERING_DAG_IRI, 'entry'), TestPhaseNode.of('entry', ['success']), { 'success': placementIri(ORDERING_DAG_IRI, 'end') }, { 'name': 'entry' })
      .phase(placementIri(ORDERING_DAG_IRI, 'setup'), 'pre', TestPhaseNode.of('setup', ['success']), { 'name': 'setup' })
      .phase(placementIri(ORDERING_DAG_IRI, 'teardown'), 'post', TestPhaseNode.of('teardown', ['success']), { 'name': 'teardown' })
      .terminal(placementIri(ORDERING_DAG_IRI, 'end'), { 'name': 'end' })
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute(ORDERING_DAG_IRI, new TrackingState());
    assert.deepEqual(result.executedNodes, ['setup', 'entry', 'end', 'teardown']);
  });
});

// ── 6. Validation: phase.node must resolve ───────────────────────────────

void describe('PhaseNode placements: registration validation', () => {
  void it('registerDAG throws when a PhaseNode references an unregistered node', () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(TestPhaseNode.of('entry', ['success']));

    const dag: DAGType = {
      '@context': DAG_CONTEXT,
      '@id': BAD_PHASE_DAG_IRI,
      '@type':    'DAG',
      'name':       'bad-phase',
      'version':    '1',
      'entrypoints': { 'main': placementIri(BAD_PHASE_DAG_IRI, 'entry') },
      'nodes': [
        {
          '@id': 'urn:noocodec:dag:bad-phase/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'urn:noocodec:node:entry',
          'outputs': { 'success': placementIri(BAD_PHASE_DAG_IRI, 'end') },
        },
        {
          '@id': 'urn:noocodec:dag:bad-phase/node/missing',
          '@type': 'PhaseNode',
          'name':  'missing',
          'node':  'urn:noocodec:node:not-registered',
          'phase': 'pre',
        },
        { '@id': 'urn:noocodec:dag:bad-phase/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), /unknown registered node: urn:noocodec:node:not-registered/u);
  });
});
