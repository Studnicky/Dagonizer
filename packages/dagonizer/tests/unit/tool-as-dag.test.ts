/**
 * Tests: ToolRegistry — a tool is an embeddable DAG.
 *
 * Verifies that:
 *   1. `ToolRegistry.register` synthesizes a `tool:<name>` DAG.
 *   2. `resolve` returns the definition and dagName, or null on a miss.
 *   3. Duplicate `register` throws `DAGError`.
 *   4. `bundle()` wires all synthesized nodes + DAGs into a dispatcher.
 *   5. A parent DAG can embed `tool:calculator` via the Wave-0 literal-embed
 *      idiom; the tool runs inside the embedded DAG and results map back
 *      to parent state — "a tool is an embeddable DAG" is proven end-to-end.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { ToolInterface } from '../../src/tool/ToolInterface.js';
import { ToolInvocationState } from '../../src/tool/ToolInvocationState.js';
import { ToolRegistry } from '../../src/tool/ToolRegistry.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A minimal calculator tool: adds two numbers.
 * Implements `ToolInterface` as a class — the only extension mechanism.
 */
class CalculatorTool implements ToolInterface<Record<string, unknown>, { 'result': number }> {
  readonly definition = {
    'name': 'calculator',
    'description': 'Adds two numbers.',
    'inputSchema': {
      'type': 'object' as const,
      'required': ['a', 'b'],
      'properties': {
        'a': { 'type': 'number' },
        'b': { 'type': 'number' },
      },
    },
    'outputSchema': {
      'type': 'object' as const,
      'required': ['result'],
      'properties': { 'result': { 'type': 'number' } },
    },
    'strict': true,
  };

  async execute(input: Record<string, unknown>): Promise<{ 'result': number }> {
    const a = Number(input['a']);
    const b = Number(input['b']);
    return { 'result': a + b };
  }
}

/**
 * A tool that always throws — for error-path coverage.
 */
class AlwaysFailTool implements ToolInterface<Record<string, unknown>, never> {
  readonly definition = {
    'name': 'alwaysFail',
    'description': 'Always throws.',
    'inputSchema': { 'type': 'object' as const },
    'outputSchema': { 'type': 'object' as const },
    'strict': false,
  };

  async execute(_input: Record<string, unknown>): Promise<never> {
    throw new Error('intentional failure');
  }
}

/**
 * Parent state for the end-to-end embed test.
 * `toolInput` seeds the child `ToolInvocationState.input`;
 * `toolOutput` receives the child `ToolInvocationState.output` back.
 */
class ParentState extends NodeStateBase {
  toolInput: Record<string, unknown>;
  toolOutput: unknown;

  constructor() {
    super();
    // Initialise in declaration order — V8 shape stability.
    this.toolInput  = { 'a': 3, 'b': 7 };
    this.toolOutput = null;
  }
}

// ── ToolRegistry.resolve ──────────────────────────────────────────────────────

void describe('ToolRegistry: resolve', () => {
  void it('resolve returns definition and dagName for a registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());

    const resolved = registry.resolve('calculator');

    assert.ok(resolved !== null, 'should resolve a registered tool');
    assert.equal(resolved['dagName'], 'tool:calculator');
    assert.equal(resolved['definition']['name'], 'calculator');
  });

  void it('resolve returns null for an unregistered tool name', () => {
    const registry = new ToolRegistry();
    const resolved  = registry.resolve('nope');
    assert.equal(resolved, null);
  });
});

// ── ToolRegistry.register: duplicate throws ───────────────────────────────────

void describe('ToolRegistry: duplicate registration', () => {
  void it('throws DAGError when the same tool name is registered twice', () => {
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());

    assert.throws(
      () => registry.register(new CalculatorTool()),
      (err: unknown) => err instanceof DAGError,
      'duplicate registration must throw DAGError',
    );
  });
});

// ── ToolRegistry.definitions / names ─────────────────────────────────────────

void describe('ToolRegistry: definitions and names', () => {
  void it('returns definitions in insertion order', () => {
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());
    registry.register(new AlwaysFailTool());

    const names = registry.names();
    assert.deepEqual(names, ['calculator', 'alwaysFail']);

    const defs = registry.definitions();
    assert.equal(defs.length, 2);
    assert.equal(defs[0]?.['name'], 'calculator');
    assert.equal(defs[1]?.['name'], 'alwaysFail');
  });
});

// ── ToolInvocationState: snapshot / restore ───────────────────────────────────

void describe('ToolInvocationState: snapshot / restore', () => {
  void it('round-trips input and output through snapshot / applySnapshot', () => {
    const state   = new ToolInvocationState();
    state.input   = { 'a': 1, 'b': 2 };
    state.output  = { 'result': 3 };

    const snap      = state.snapshot();
    const restored  = ToolInvocationState.restore(snap);

    assert.deepEqual(restored.input,  { 'a': 1, 'b': 2 });
    assert.deepEqual(restored.output, { 'result': 3 });
  });
});

// ── End-to-end: a tool is an embeddable DAG ───────────────────────────────────

void describe('ToolRegistry: a tool is an embeddable DAG (end-to-end)', () => {
  void it('embeds tool:calculator in a parent DAG, tool runs, result maps back to parent state', async () => {
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());

    // Parent DAG: one embeddedDAG placement targeting 'tool:calculator'.
    // inputs:  seed child `input` from parent's `toolInput`.
    // outputs: copy child `output` back to parent's `toolOutput`.
    const parentDag = new DAGBuilder('parent-calc', '1')
      .embeddedDAG<ToolInvocationState, ParentState>(
        'call-calc',
        'tool:calculator',
        { 'success': 'end', 'error': 'end-fail' },
        {
          'inputs':  { 'input': 'toolInput' },
          'outputs': { 'toolOutput': 'output' },
        },
      )
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    // Dispatcher: register the tool bundle first, then the parent DAG.
    const dispatcher = new Dagonizer<ParentState>();
    // ToolInvocationState is the child's state; ParentState is the parent's.
    // registerBundle<TBundleState> accepts any DispatcherBundleType subtype —
    // the dispatcher widens the state type during registration via bivariance.
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    const state  = new ParentState();
    const result = await dispatcher.execute('parent-calc', state);

    assert.equal(result.terminalOutcome, 'completed');
    // Tool ran: 3 + 7 = 10.
    assert.deepEqual(state.toolOutput, { 'result': 10 }, 'tool result must map back to parent state');
    // Isolation: the tool ran on a fresh ToolInvocationState (registered via the
    // bundle's isolation factory), NOT a clone of ParentState — so the child's
    // `input`/`output` fields never leaked onto the parent (no shared-state
    // mutation, no V8 shape violation). A tool is a pure function.
    assert.ok(!Object.hasOwn(state, 'input'), 'child `input` field must not leak onto parent state');
    assert.ok(!Object.hasOwn(state, 'output'), 'child `output` field must not leak onto parent state');
  });

  void it('routes to end-fail when the tool throws', async () => {
    const registry = new ToolRegistry();
    registry.register(new AlwaysFailTool());

    const parentDag = new DAGBuilder('parent-fail', '1')
      .embeddedDAG<ToolInvocationState, ParentState>(
        'call-fail',
        'tool:alwaysFail',
        { 'success': 'end', 'error': 'end-fail' },
        {
          'inputs': { 'input': 'toolInput' },
        },
      )
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ParentState>();
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    const state  = new ParentState();
    const result = await dispatcher.execute('parent-fail', state);

    // ToolInvokeNode routes to 'error' → 'end-fail' terminal → failed outcome.
    assert.equal(result.terminalOutcome, 'failed');
  });
});
