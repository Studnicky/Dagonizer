import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/index.js';
import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { NoopInstrumentation } from '../../src/runtime/NoopInstrumentation.js';
import { Validator } from '../../src/validation/Validator.js';

// ── Helpers ───────────────────────────────────────────────────────────────

class TrackingState extends NodeStateBase {
  trace: string[] = [];
}

const makeNode = (
  name: string,
  outputs: readonly string[] = ['success'],
  side?: (state: TrackingState) => void | Promise<void>,
): NodeInterface<TrackingState> => ({
  name,
  outputs,
  async execute(state) {
    if (side) {
      await side(state);
    } else {
      state.trace.push(name);
    }
    return { 'output': outputs[0] as string };
  },
});

const makeThrowingNode = (
  name: string,
  message: string,
): NodeInterface<TrackingState> => ({
  name,
  'outputs': ['success'],
  async execute() {
    throw new Error(message);
  },
});

// Recording instrumentation captures phase hook invocations in order.
interface Call {
  readonly hook: string;
  readonly args: readonly unknown[];
}

class RecordingInstrumentation extends NoopInstrumentation<TrackingState> {
  readonly calls: Call[] = [];

  override phaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TrackingState, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'phaseEnter', 'args': [dagName, phase, placementName, state, placementPath] });
  }
  override phaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TrackingState, placementPath: readonly string[]): void {
    this.calls.push({ 'hook': 'phaseExit', 'args': [dagName, phase, placementName, state, placementPath] });
  }
  override flowStart(dagName: string, state: TrackingState): void {
    this.calls.push({ 'hook': 'flowStart', 'args': [dagName, state] });
  }
  override flowEnd(dagName: string, _state: TrackingState): void {
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
      '@id':   'urn:noocodex:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'setup-node',
      'phase': 'pre',
    };
    assert.equal(Validator.phaseNode.is(valid), true);
  });

  void it('accepts a valid post-phase placement', () => {
    const valid = {
      '@id':   'urn:noocodex:dag:demo/node/teardown',
      '@type': 'PhaseNode',
      'name':  'teardown',
      'node':  'teardown-node',
      'phase': 'post',
    };
    assert.equal(Validator.phaseNode.is(valid), true);
  });

  void it('rejects a PhaseNode missing phase field', () => {
    const bad = {
      '@id':   'urn:noocodex:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'setup-node',
    };
    assert.equal(Validator.phaseNode.is(bad), false);
  });

  void it('rejects phase=mid (not in enum)', () => {
    const bad = {
      '@id':   'urn:noocodex:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'setup-node',
      'phase': 'mid',
    };
    assert.equal(Validator.phaseNode.is(bad), false);
  });

  void it('rejects an extra outputs field (additionalProperties: false)', () => {
    const bad = {
      '@id':   'urn:noocodex:dag:demo/node/setup',
      '@type': 'PhaseNode',
      'name':  'setup',
      'node':  'setup-node',
      'phase': 'pre',
      'outputs': { 'success': 'end' },
    };
    assert.equal(Validator.phaseNode.is(bad), false);
  });

  void it('PhaseNode passes Validator.dag.is() when embedded in a DAG', () => {
    const dag: unknown = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:demo',
      '@type':    'DAG',
      'name':       'demo',
      'version':    '1',
      'entrypoint': 'a',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:demo/node/setup',
          '@type': 'PhaseNode',
          'name':  'setup',
          'node':  'setup-node',
          'phase': 'pre',
        },
        {
          '@id':   'urn:noocodex:dag:demo/node/a',
          '@type': 'SingleNode',
          'name':  'a',
          'node':  'a',
          'outputs': { 'success': 'end' },
        },
        { '@id': 'urn:noocodex:dag:demo/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    assert.equal(Validator.dag.is(dag), true);
  });
});

// ── 2. Pre-phase execution ────────────────────────────────────────────────

void describe('PhaseNode placements: pre-phase execution', () => {
  void it('pre-phase runs before the entrypoint and its mutations are visible to the entrypoint', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeNode('setup-node', ['success'], (state) => {
      state.trace.push('pre-setup');
    }));
    dispatcher.registerNode(makeNode('entry', ['success']));

    const dag = new DAGBuilder('pre-runs-first', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('setup', 'pre', makeNode('setup-node', ['success']))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('pre-runs-first', new TrackingState());
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.deepEqual(result.state.trace, ['pre-setup', 'entry']);
  });

  void it('pre-phase throw aborts the run; lifecycle is failed and main loop never executes', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeThrowingNode('boom-pre', 'pre-phase fail'));
    dispatcher.registerNode(makeNode('entry', ['success']));

    const dag = new DAGBuilder('pre-aborts', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('boom', 'pre', makeThrowingNode('boom-pre', 'pre-phase fail'))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const state = new TrackingState();
    const result = await dispatcher.execute('pre-aborts', state);
    assert.equal(result.state.lifecycle.kind, 'failed');
    assert.equal(state.trace.includes('entry'), false, 'entrypoint must not run');
  });

  void it('multiple pre-phases run in declaration order', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeNode('p1', ['success'], (s) => { s.trace.push('p1'); }));
    dispatcher.registerNode(makeNode('p2', ['success'], (s) => { s.trace.push('p2'); }));
    dispatcher.registerNode(makeNode('p3', ['success'], (s) => { s.trace.push('p3'); }));
    dispatcher.registerNode(makeNode('entry', ['success']));

    const dag = new DAGBuilder('multi-pre', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('p1', 'pre', makeNode('p1', ['success']))
      .phase('p2', 'pre', makeNode('p2', ['success']))
      .phase('p3', 'pre', makeNode('p3', ['success']))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('multi-pre', new TrackingState());
    assert.deepEqual(result.state.trace, ['p1', 'p2', 'p3', 'entry']);
  });
});

// ── 3. Post-phase execution ───────────────────────────────────────────────

void describe('PhaseNode placements: post-phase execution', () => {
  void it('post-phase runs after the main loop on the success path', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeNode('entry', ['success']));
    dispatcher.registerNode(makeNode('teardown', ['success'], (s) => { s.trace.push('post-teardown'); }));

    const dag = new DAGBuilder('post-success', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('teardown', 'post', makeNode('teardown', ['success']))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('post-success', new TrackingState());
    assert.equal(result.state.lifecycle.kind, 'completed');
    assert.deepEqual(result.state.trace, ['entry', 'post-teardown']);
  });

  void it('post-phase runs after the main loop on the abort path', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeNode('teardown', ['success'], (s) => { s.trace.push('post-teardown'); }));

    // Slow node that signals readiness once suspended, then waits for abort.
    // Using a readiness promise avoids any wall-clock dependency.
    let resolveNodeReady!: () => void;
    const nodeReady = new Promise<void>((r) => { resolveNodeReady = r; });

    dispatcher.registerNode({
      'name': 'slow',
      'outputs': ['success'],
      async execute(_state, ctx) {
        resolveNodeReady();
        await new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          }, { 'once': true });
        });
        return { 'output': 'success' };
      },
    });

    const dag = new DAGBuilder('post-abort', '1')
      .node('slow', makeNode('slow', ['success']), { 'success': 'end' })
      .phase('teardown', 'post', makeNode('teardown', ['success']))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const controller = new AbortController();
    const state = new TrackingState();
    const exec = dispatcher.execute('post-abort', state, { 'signal': controller.signal });
    // Abort deterministically once the node body is provably suspended.
    nodeReady.then(() => { controller.abort(); });
    const result = await exec;
    assert.equal(['cancelled', 'failed'].includes(result.state.lifecycle.kind), true);
    assert.ok(state.trace.includes('post-teardown'), 'post-phase ran on abort path');
  });

  void it('post-phase throw collects a warning; lifecycle is unchanged', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeNode('entry', ['success']));
    dispatcher.registerNode(makeThrowingNode('boom-post', 'post-phase fail'));

    const dag = new DAGBuilder('post-throws', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('boom', 'post', makeThrowingNode('boom-post', 'post-phase fail'))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('post-throws', new TrackingState());
    assert.equal(result.state.lifecycle.kind, 'completed', 'lifecycle is unchanged');
    const warnings = result.state.warnings;
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.code, 'POST_PHASE_FAILED');
    assert.equal(warnings[0]?.operation, 'boom');
  });

  void it('multiple post-phases run in declaration order', async () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeNode('entry', ['success']));
    dispatcher.registerNode(makeNode('p1', ['success'], (s) => { s.trace.push('p1'); }));
    dispatcher.registerNode(makeNode('p2', ['success'], (s) => { s.trace.push('p2'); }));
    dispatcher.registerNode(makeNode('p3', ['success'], (s) => { s.trace.push('p3'); }));

    const dag = new DAGBuilder('multi-post', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('p1', 'post', makeNode('p1', ['success']))
      .phase('p2', 'post', makeNode('p2', ['success']))
      .phase('p3', 'post', makeNode('p3', ['success']))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('multi-post', new TrackingState());
    assert.deepEqual(result.state.trace, ['entry', 'p1', 'p2', 'p3']);
  });
});

// ── 4. Instrumentation hooks ──────────────────────────────────────────────

void describe('PhaseNode placements: instrumentation hooks', () => {
  void it('phaseEnter / phaseExit fire with correct phase + placement name', async () => {
    const instrumentation = new RecordingInstrumentation();
    const dispatcher = new Dagonizer<TrackingState>({ instrumentation });

    dispatcher.registerNode(makeNode('setup', ['success']));
    dispatcher.registerNode(makeNode('entry', ['success']));
    dispatcher.registerNode(makeNode('teardown', ['success']));

    const dag = new DAGBuilder('instr-phases', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('setup', 'pre', makeNode('setup', ['success']))
      .phase('teardown', 'post', makeNode('teardown', ['success']))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);
    await dispatcher.execute('instr-phases', new TrackingState());

    const enters = instrumentation.hooksOfType('phaseEnter');
    const exits  = instrumentation.hooksOfType('phaseExit');

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
    dispatcher.registerNode(makeNode('setup', ['success']));
    dispatcher.registerNode(makeNode('teardown', ['success']));
    dispatcher.registerNode(makeNode('entry', ['success']));

    const dag = new DAGBuilder('ordering', '1')
      .node('entry', makeNode('entry', ['success']), { 'success': 'end' })
      .phase('setup', 'pre', makeNode('setup', ['success']))
      .phase('teardown', 'post', makeNode('teardown', ['success']))
      .terminal('end')
      .build();

    dispatcher.registerDAG(dag);

    const result = await dispatcher.execute('ordering', new TrackingState());
    assert.deepEqual(result.executedNodes, ['setup', 'entry', 'end', 'teardown']);
  });
});

// ── 6. Validation: phase.node must resolve ───────────────────────────────

void describe('PhaseNode placements: registration validation', () => {
  void it('registerDAG throws when a PhaseNode references an unregistered node', () => {
    const dispatcher = new Dagonizer<TrackingState>();
    dispatcher.registerNode(makeNode('entry', ['success']));

    const dag: DAG = {
      '@context': DAG_CONTEXT,
      '@id':      'urn:noocodex:dag:bad-phase',
      '@type':    'DAG',
      'name':       'bad-phase',
      'version':    '1',
      'entrypoint': 'entry',
      'nodes': [
        {
          '@id':   'urn:noocodex:dag:bad-phase/node/entry',
          '@type': 'SingleNode',
          'name':  'entry',
          'node':  'entry',
          'outputs': { 'success': 'end' },
        },
        {
          '@id':   'urn:noocodex:dag:bad-phase/node/missing',
          '@type': 'PhaseNode',
          'name':  'missing',
          'node':  'not-registered',
          'phase': 'pre',
        },
        { '@id': 'urn:noocodex:dag:bad-phase/node/end', '@type': 'TerminalNode', 'name': 'end', 'outcome': 'completed' }
      ],
    };
    assert.throws(() => dispatcher.registerDAG(dag), /unknown registered node: not-registered/);
  });
});
