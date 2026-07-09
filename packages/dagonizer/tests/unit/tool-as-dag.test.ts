/**
 * Tests: ToolRegistry — a tool is an embeddable DAG.
 *
 * Verifies that:
 *   1. `ToolRegistry.register` synthesizes a `urn:noocodec:tool:<name>` DAG.
 *   2. `resolve` returns the definition and dagIri, or null on a miss.
 *   3. Duplicate `register` throws `DAGError`.
 *   4. `bundle()` wires all synthesized nodes + DAGs into a dispatcher.
 *   5. A parent DAG can embed `urn:noocodec:tool:calculator` via the Wave-0 literal-embed
 *      idiom; the tool runs inside the embedded DAG and results map back
 *      to parent state — "a tool is an embeddable DAG" is proven end-to-end.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import { NodeContext } from '../../src/entities/node/NodeContext.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { ToolInterface } from '../../src/tool/ToolInterface.js';
import { ToolInvocationState } from '../../src/tool/ToolInvocationState.js';
import { ToolInvokeNode } from '../../src/tool/ToolInvokeNode.js';
import { ToolRegistry } from '../../src/tool/ToolRegistry.js';
import { Validator } from '../../src/validation/Validator.js';

const PARENT_CALCULATOR_DAG_IRI = 'urn:noocodec:dag:tool-parent-calculator';
const PARENT_CALCULATOR_CALL_IRI = 'urn:noocodec:dag:tool-parent-calculator/node/call-calculator';
const PARENT_CALCULATOR_END_IRI = 'urn:noocodec:dag:tool-parent-calculator/node/end';
const PARENT_CALCULATOR_FAIL_IRI = 'urn:noocodec:dag:tool-parent-calculator/node/end-fail';

const PARENT_FAILING_TOOL_DAG_IRI = 'urn:noocodec:dag:tool-parent-failure';
const PARENT_FAILING_TOOL_CALL_IRI = 'urn:noocodec:dag:tool-parent-failure/node/call-tool';
const PARENT_FAILING_TOOL_END_IRI = 'urn:noocodec:dag:tool-parent-failure/node/end';
const PARENT_FAILING_TOOL_FAIL_IRI = 'urn:noocodec:dag:tool-parent-failure/node/end-fail';

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
  void it('resolve returns definition and dagIri for a registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());

    const resolved = registry.resolve('calculator');

    assert.ok(resolved !== null, 'should resolve a registered tool');
    assert.equal(resolved['dagIri'], 'urn:noocodec:tool:calculator');
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
  void it('embeds urn:noocodec:tool:calculator in a parent DAG, tool runs, result maps back to parent state', async () => {
    const registry = new ToolRegistry();
    registry.register(new CalculatorTool());

    // Parent DAG: one embedded-DAG placement targeting 'urn:noocodec:tool:calculator'.
    // inputs:  seed child `input` from parent's `toolInput`.
    // outputs: copy child `output` back to parent's `toolOutput`.
    const parentDag = new DAGBuilder(PARENT_CALCULATOR_DAG_IRI, '1', { 'name': 'parent-calc' })
      .embed<ToolInvocationState, ParentState>(
        PARENT_CALCULATOR_CALL_IRI,
        'urn:noocodec:tool:calculator',
        {
          'success': PARENT_CALCULATOR_END_IRI,
          'error': PARENT_CALCULATOR_FAIL_IRI,
        },
        {
          'name': 'call-calc',
          'inputs':  { 'input': 'toolInput' },
          'outputs': { 'toolOutput': 'output' },
        },
      )
      .terminal(PARENT_CALCULATOR_END_IRI, { 'name': 'end' })
      .terminal(PARENT_CALCULATOR_FAIL_IRI, { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    // Dispatcher: register the tool bundle first, then the parent DAG.
    const dispatcher = new Dagonizer<ParentState>();
    // ToolInvocationState is the child's state; ParentState is the parent's.
    // registerBundle<TBundleState> accepts any DispatcherBundleType subtype —
    // the dispatcher widens the state type during registration via bivariance.
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    const state  = new ParentState();
    const result = await dispatcher.execute(PARENT_CALCULATOR_DAG_IRI, state);

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

    const parentDag = new DAGBuilder(PARENT_FAILING_TOOL_DAG_IRI, '1', { 'name': 'parent-fail' })
      .embed<ToolInvocationState, ParentState>(
        PARENT_FAILING_TOOL_CALL_IRI,
        'urn:noocodec:tool:alwaysFail',
        {
          'success': PARENT_FAILING_TOOL_END_IRI,
          'error': PARENT_FAILING_TOOL_FAIL_IRI,
        },
        {
          'name': 'call-fail',
          'inputs': { 'input': 'toolInput' },
        },
      )
      .terminal(PARENT_FAILING_TOOL_END_IRI, { 'name': 'end' })
      .terminal(PARENT_FAILING_TOOL_FAIL_IRI, { 'name': 'end-fail', 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ParentState>();
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    const state  = new ParentState();
    const result = await dispatcher.execute(PARENT_FAILING_TOOL_DAG_IRI, state);

    // ToolInvokeNode routes to 'error' → 'end-fail' terminal → failed outcome.
    assert.equal(result.terminalOutcome, 'failed');
  });
});

void describe('ToolInvokeNode: batch execution', () => {
  void it('starts independent batch item tool calls concurrently', async () => {
    let active = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    class GateTool implements ToolInterface<Record<string, unknown>, { 'ok': boolean }> {
      readonly definition = {
        'name': 'gate',
        'description': 'Waits until two calls are active.',
        'inputSchema': { '$id': 'GateToolInput', 'type': 'object' as const },
        'outputSchema': {
          '$id': 'GateToolOutput',
          'type': 'object' as const,
          'required': ['ok'],
          'properties': { 'ok': { 'type': 'boolean' } },
        },
        'strict': true,
      };

      async execute(_input: Record<string, unknown>): Promise<{ 'ok': boolean }> {
        active += 1;
        if (active === 2) release?.();
        await gate;
        return { 'ok': true };
      }
    }

    const tool = new GateTool();
    const node = new ToolInvokeNode(
      'urn:noocodec:node:gate',
      'gate',
      tool,
      Validator.compile(tool.definition.inputSchema),
      Validator.compile(tool.definition.outputSchema),
      { 'execution': { 'concurrency': 2 } },
    );
    const left = new ToolInvocationState();
    left.input = { 'id': 'left' };
    const right = new ToolInvocationState();
    right.input = { 'id': 'right' };
    const batch = Batch.from([
      { 'id': 'left', 'state': left },
      { 'id': 'right', 'state': right },
    ]);
    const context = NodeContext.create('tool-test', 'gate', new AbortController().signal);

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('tool batch execution did not start both items concurrently')), 100);
    });
    const routed = await Promise.race([node.execute(batch, context), timeoutPromise]);
    if (timeout !== null) clearTimeout(timeout);

    assert.equal(active, 2);
    assert.equal(routed.get('done')?.size, 2);
    assert.deepEqual(left.output, { 'ok': true });
    assert.deepEqual(right.output, { 'ok': true });
  });

  void it('honors throttle concurrency as a second execution gate', async () => {
    let active = 0;
    let peak = 0;

    class TimedTool implements ToolInterface<Record<string, unknown>, { 'ok': boolean }> {
      readonly definition = {
        'name': 'timed',
        'description': 'Records peak active calls.',
        'inputSchema': { '$id': 'TimedToolInput', 'type': 'object' as const },
        'outputSchema': {
          '$id': 'TimedToolOutput',
          'type': 'object' as const,
          'required': ['ok'],
          'properties': { 'ok': { 'type': 'boolean' } },
        },
        'strict': true,
      };

      async execute(_input: Record<string, unknown>): Promise<{ 'ok': boolean }> {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
        active -= 1;
        return { 'ok': true };
      }
    }

    const tool = new TimedTool();
    const node = new ToolInvokeNode(
      'urn:noocodec:node:timed',
      'timed',
      tool,
      Validator.compile(tool.definition.inputSchema),
      Validator.compile(tool.definition.outputSchema),
      { 'execution': { 'concurrency': 3, 'throttle': { 'concurrencyLimit': 1 } } },
    );
    const states = [new ToolInvocationState(), new ToolInvocationState(), new ToolInvocationState()];
    const batch = Batch.from(states.map((state, index) => {
      state.input = { index };
      return { 'id': `item-${index}`, state };
    }));
    const context = NodeContext.create('tool-test', 'timed', new AbortController().signal);

    const routed = await node.execute(batch, context);

    assert.equal(peak, 1);
    assert.equal(routed.get('done')?.size, 3);
  });
});
