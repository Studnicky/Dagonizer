/**
 * Tests: output-contract validation — `outputSchema` per-port enforcement.
 *
 * Covers:
 *   (a) validateOutputs: true + node that violates outputSchema → routes to error
 *   (b) validateOutputs: true + conforming output → routes normally
 *   (c) validateOutputs: false (default) → no validation even on violation
 *   (d) registerNode throws when outputSchema omits a declared port
 *   (e) tool output contract violation → routes to error (gated by validateOutputs)
 *   (f) tool input contract violation → routes to error (gated by validateOutputs)
 *   (g) batch-native MonadicNode violation detected when validateOutputs: true
 *   (h) batch-native MonadicNode: no validation when validateOutputs: false
 *   (j) tool toggle: validateOutputs: false → wrong tool output still routes done
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { MonadicNode } from '../../src/core/MonadicNode.js';
import { ScalarNode } from '../../src/core/ScalarNode.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import type { ItemType } from '../../src/entities/batch/Item.js';
import type { RoutedBatchType } from '../../src/entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import type { ToolInterface } from '../../src/tool/ToolInterface.js';
import type { ToolInvocationState } from '../../src/tool/ToolInvocationState.js';
import { ToolRegistry } from '../../src/tool/ToolRegistry.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

class ContractState extends NodeStateBase {
  value: number;
  name: string;

  constructor() {
    super();
    // Initialise in declaration order — V8 shape stability.
    this.value = 0;
    this.name  = '';
  }
}

/**
 * A node that declares `{ minLength: 3 }` on `name` for the `'done'` port but
 * sets `state.name = ''` (empty string, fails minLength). This simulates a
 * contract violation when validateOutputs is true.
 */
class ViolatingNode extends ScalarNode<ContractState, 'done' | 'error'> {
  readonly name = 'violating-node';
  readonly outputs = ['done', 'error'] as const;

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done': {
        'type': 'object',
        'required': ['name'],
        'properties': { 'name': { 'type': 'string', 'minLength': 3 } },
      },
      'error': { 'type': 'object' },
    };
  }

  protected async executeOne(
    state: ContractState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'done' | 'error'>> {
    // Sets name to '' — violates minLength: 3
    state.name = '';
    return NodeOutputBuilder.of('done');
  }
}

/**
 * A node whose output satisfies its declared outputSchema.
 */
class ConformingNode extends ScalarNode<ContractState, 'done' | 'error'> {
  readonly name = 'conforming-node';
  readonly outputs = ['done', 'error'] as const;

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done': {
        'type': 'object',
        'required': ['name'],
        'properties': { 'name': { 'type': 'string', 'minLength': 3 } },
      },
      'error': { 'type': 'object' },
    };
  }

  protected async executeOne(
    state: ContractState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'done' | 'error'>> {
    // Sets name to a value satisfying minLength: 3
    state.name = 'ok!';
    return NodeOutputBuilder.of('done');
  }
}

/**
 * A node whose outputSchema is missing an entry for the `'skip'` port.
 * Registering this node must throw DAGError (structural enforcement at registerNode).
 */
class MissingPortSchemaNode extends ScalarNode<ContractState, 'done' | 'skip' | 'error'> {
  readonly name = 'missing-port-schema';
  readonly outputs = ['done', 'skip', 'error'] as const;

  // Only 'done' and 'error' present — 'skip' is missing from the schema.
  override get outputSchema(): Record<string, SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  protected async executeOne(
    _state: ContractState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'done' | 'skip' | 'error'>> {
    return NodeOutputBuilder.of('done');
  }
}

// ── Tool fixtures ─────────────────────────────────────────────────────────────

/**
 * Parent state for tool embed tests.
 */
class ToolParentState extends NodeStateBase {
  toolInput: Record<string, unknown>;
  toolOutput: unknown;

  constructor() {
    super();
    this.toolInput  = {};
    this.toolOutput = null;
  }
}

/**
 * A tool whose `execute` returns a primitive number instead of `{ result: number }`.
 * Since `outputSchema` requires `{ type: 'object', required: ['result'], ... }`,
 * returning `42` violates the output contract.
 */
class BadOutputTool implements ToolInterface<Record<string, unknown>, unknown> {
  readonly definition = {
    'name': 'badOutput',
    'description': 'Returns a non-object, violating outputSchema.',
    'inputSchema': { 'type': 'object' as const },
    'outputSchema': {
      'type': 'object' as const,
      'required': ['result'],
      'properties': { 'result': { 'type': 'number' } },
    },
    'strict': false,
  };

  async execute(_input: Record<string, unknown>): Promise<unknown> {
    // Returns a number, not { result: number } — violates outputSchema.
    return 42;
  }
}

/**
 * A tool with an inputSchema that requires `a` and `b` as numbers with
 * `additionalProperties: false`. Calling it without `b` triggers input
 * contract violation.
 */
class StrictInputTool implements ToolInterface<Record<string, unknown>, unknown> {
  readonly definition = {
    'name': 'strictInput',
    'description': 'Requires a and b.',
    'inputSchema': {
      'type': 'object' as const,
      'required': ['a', 'b'],
      'properties': {
        'a': { 'type': 'number' },
        'b': { 'type': 'number' },
      },
      'additionalProperties': false,
    },
    'outputSchema': { 'type': 'object' as const },
    'strict': true,
  };

  async execute(input: Record<string, unknown>): Promise<unknown> {
    return { 'sum': Number(input['a']) + Number(input['b']) };
  }
}

// ── Batch-native MonadicNode fixture ─────────────────────────────────────────

/**
 * A batch-native node extending MonadicNode directly (not ScalarNode).
 * Sets state.name = '' on every item — violates minLength: 3 on the 'done' port.
 * Used to verify that validation is applied uniformly at the dispatch funnel,
 * not just inside ScalarNode.
 */
class BatchViolatingNode extends MonadicNode<ContractState, 'done' | 'error'> {
  readonly name = 'batch-violating-node';
  readonly outputs = ['done', 'error'] as const;

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done': {
        'type': 'object',
        'required': ['name'],
        'properties': { 'name': { 'type': 'string', 'minLength': 3 } },
      },
      'error': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<ContractState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'done' | 'error', ContractState>> {
    const items: ItemType<ContractState>[] = [];
    for (const item of batch) {
      item.state.name = '';
      items.push(item);
    }
    return new Map([['done', Batch.from(items)]]);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('outputSchema contract — validateOutputs toggle', () => {

  // (a) validateOutputs: true + violation → error ────────────────────────────

  void it('(a) routes to error when validateOutputs is true and node violates outputSchema', async () => {
    const node = new ViolatingNode();
    const dag = new DAGBuilder('test-violating', '1')
      .node('violating-node', node, { 'done': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ContractState>({ 'validateOutputs': true });
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new ContractState();
    const result = await dispatcher.execute('test-violating', state);

    // Item re-routed to 'error' → 'end-fail' terminal → failed outcome.
    assert.equal(result.terminalOutcome, 'failed', 'output contract violation must route to failed');
    const contractErrors = state.errors.filter((e) => e.code === 'outputContractViolation');
    assert.ok(contractErrors.length > 0, 'state must contain outputContractViolation error');
  });

  // (b) validateOutputs: true + conforming → routes normally ─────────────────

  void it('(b) routes normally when validateOutputs is true and node satisfies outputSchema', async () => {
    const node = new ConformingNode();
    const dag = new DAGBuilder('test-conforming', '1')
      .node('conforming-node', node, { 'done': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ContractState>({ 'validateOutputs': true });
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new ContractState();
    const result = await dispatcher.execute('test-conforming', state);

    assert.equal(result.terminalOutcome, 'completed', 'conforming output must route to completed');
    const contractErrors = state.errors.filter((e) => e.code === 'outputContractViolation');
    assert.equal(contractErrors.length, 0, 'no contract errors expected');
  });

  // (c) toggle OFF → no validation ────────────────────────────────────────────

  void it('(c) does not validate when validateOutputs is false (default)', async () => {
    const node = new ViolatingNode();
    const dag = new DAGBuilder('test-violating-off', '1')
      .node('violating-node', node, { 'done': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    // Default: validateOutputs is false.
    const dispatcher = new Dagonizer<ContractState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new ContractState();
    const result = await dispatcher.execute('test-violating-off', state);

    // No validation → node routes 'done' → 'end' → completed.
    assert.equal(result.terminalOutcome, 'completed', 'no validation by default — should complete');
    const contractErrors = state.errors.filter((e) => e.code === 'outputContractViolation');
    assert.equal(contractErrors.length, 0, 'no contract errors when toggle is off');
  });

  // (d) registerNode throws when outputSchema omits a declared port ────────────

  void it('(d) registerNode throws DAGError when outputSchema omits a declared port', () => {
    const dispatcher = new Dagonizer<ContractState>();

    assert.throws(
      () => dispatcher.registerNode(new MissingPortSchemaNode()),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, 'must throw DAGError');
        assert.ok(
          err.message.includes('skip'),
          `error message must reference the missing port 'skip'; got: ${err.message}`,
        );
        return true;
      },
      'registerNode must throw for missing port in outputSchema',
    );
  });

  // (e) tool output contract violation ─────────────────────────────────────────

  void it('(e) routes to error when tool returns wrong output shape', async () => {
    const registry = new ToolRegistry();
    registry.register(new BadOutputTool());

    const parentDag = new DAGBuilder('parent-bad-output', '1')
      .embeddedDAG<ToolInvocationState, ToolParentState>(
        'call-bad',
        'tool:badOutput',
        { 'success': 'end', 'error': 'end-fail' },
        { 'inputs': { 'input': 'toolInput' } },
      )
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ToolParentState>({ 'validateOutputs': true });
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    const state = new ToolParentState();
    const result = await dispatcher.execute('parent-bad-output', state);

    // ToolInvokeNode routes to 'error' → 'end-fail' → failed outcome.
    assert.equal(result.terminalOutcome, 'failed', 'tool output violation must route to failed');
  });

  // (f) tool input contract violation ──────────────────────────────────────────

  void it('(f) routes to error when tool receives wrong input shape', async () => {
    const registry = new ToolRegistry();
    registry.register(new StrictInputTool());

    const parentDag = new DAGBuilder('parent-bad-input', '1')
      .embeddedDAG<ToolInvocationState, ToolParentState>(
        'call-strict',
        'tool:strictInput',
        { 'success': 'end', 'error': 'end-fail' },
        { 'inputs': { 'input': 'toolInput' } },
      )
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ToolParentState>({ 'validateOutputs': true });
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    // toolInput deliberately omits required 'b' — triggers input contract violation.
    const state = new ToolParentState();
    state.toolInput = { 'a': 1 };
    const result = await dispatcher.execute('parent-bad-input', state);

    // ToolInvokeNode routes to 'error' → 'end-fail' → failed outcome.
    assert.equal(result.terminalOutcome, 'failed', 'tool input violation must route to failed');
  });

  // (g) Batch-native MonadicNode violation detected when validateOutputs: true ──

  void it('(g) routes to error when a batch-native MonadicNode violates outputSchema and validateOutputs is true', async () => {
    const node = new BatchViolatingNode();
    const dag = new DAGBuilder('test-batch-violating', '1')
      .node('batch-violating-node', node, { 'done': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ContractState>({ 'validateOutputs': true });
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new ContractState();
    const result = await dispatcher.execute('test-batch-violating', state);

    assert.equal(result.terminalOutcome, 'failed', 'batch-native violation must route to failed');
    const contractErrors = state.errors.filter((e) => e.code === 'outputContractViolation');
    assert.ok(contractErrors.length > 0, 'state must contain outputContractViolation error');
  });

  // (h) Batch-native MonadicNode: no validation when validateOutputs: false ────

  void it('(h) does not validate a batch-native MonadicNode when validateOutputs is false', async () => {
    const node = new BatchViolatingNode();
    const dag = new DAGBuilder('test-batch-violating-off', '1')
      .node('batch-violating-node', node, { 'done': 'end', 'error': 'end-fail' })
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    const dispatcher = new Dagonizer<ContractState>();
    dispatcher.registerNode(node);
    dispatcher.registerDAG(dag);

    const state = new ContractState();
    const result = await dispatcher.execute('test-batch-violating-off', state);

    assert.equal(result.terminalOutcome, 'completed', 'no validation by default for batch-native — should complete');
    const contractErrors = state.errors.filter((e) => e.code === 'outputContractViolation');
    assert.equal(contractErrors.length, 0, 'no contract errors when toggle is off');
  });

  // (j) tool toggle: validateOutputs: false → wrong tool output routes done ────

  void it('(j) does not validate tool output when validateOutputs is false', async () => {
    const registry = new ToolRegistry();
    registry.register(new BadOutputTool());

    const parentDag = new DAGBuilder('parent-bad-output-off', '1')
      .embeddedDAG<ToolInvocationState, ToolParentState>(
        'call-bad',
        'tool:badOutput',
        { 'success': 'end', 'error': 'end-fail' },
        { 'inputs': { 'input': 'toolInput' } },
      )
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    // validateOutputs: false (default) → tool output validation skipped.
    const dispatcher = new Dagonizer<ToolParentState>();
    dispatcher.registerBundle(registry.bundle());
    dispatcher.registerDAG(parentDag);

    const state = new ToolParentState();
    const result = await dispatcher.execute('parent-bad-output-off', state);

    // No validation → tool routes 'done' → 'end' → completed (despite wrong output shape).
    assert.equal(result.terminalOutcome, 'completed', 'tool output not validated when toggle is off — should complete');
  });
});
