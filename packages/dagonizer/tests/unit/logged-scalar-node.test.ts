/**
 * LoggedScalarNode: route-don't-throw enforcement.
 *
 * Covers:
 *   (a) Normal subclass: routes to the declared output port, no errors collected.
 *   (b) Throwing subclass (devMode: true, default): throw is caught, error is
 *       collected onto state, the escaped throw surfaces as a contract violation
 *       error (does not propagate as the original throw).
 *   (c) Contract error names the offending node.
 *   (d) Throwing subclass (devMode: false): throw is caught silently, routed to
 *       'error', nothing re-thrown.
 *   (e) Subclass that explicitly routes to 'error' without throwing: works normally.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SchemaObjectType } from '../../src/contracts/NodeInterface.js';
import { LoggedScalarNode } from '../../src/core/LoggedScalarNode.js';
import type { LoggedScalarNodeOptionsType } from '../../src/core/LoggedScalarNode.js';
import { NodeRunner } from '../../src/core/NodeRunner.js';
import { Batch } from '../../src/entities/batch/Batch.js';
import { NodeContextBuilder } from '../../src/entities/node/NodeContext.js';
import type { NodeContextType } from '../../src/entities/node/NodeContext.js';
import { NodeOutputBuilder } from '../../src/entities/node/NodeOutput.js';
import type { NodeOutputType } from '../../src/entities/node/NodeOutput.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';

// ── Shared context ────────────────────────────────────────────────────────────

const CTX: NodeContextType = NodeContextBuilder.of(
  'test-dag',
  'test-node',
  new AbortController().signal,
  undefined,
);

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A well-behaved node: routes to 'done' normally, no throws.
 */
class NormalNode extends LoggedScalarNode<NodeStateBase, 'done'> {
  readonly name = 'normal-node';
  readonly outputs = ['done', 'error'] as const;

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  protected override async runOne(
    _state: NodeStateBase,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'done'>> {
    return NodeOutputBuilder.of('done');
  }
}

/**
 * A violating node: throws unconditionally from `runOne`.
 * Accepts `devMode` via constructor options for (b) vs (d) coverage.
 */
class ThrowingNode extends LoggedScalarNode<NodeStateBase, 'done'> {
  readonly name = 'throwing-node';
  readonly outputs = ['done', 'error'] as const;

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  constructor(options: LoggedScalarNodeOptionsType) {
    super(options);
  }

  protected override async runOne(
    _state: NodeStateBase,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'done'>> {
    throw new Error('runOne threw');
  }
}

/**
 * A node that explicitly routes to 'error' without throwing.
 * Verifies that explicit error routing still works cleanly through the base.
 */
class ExplicitErrorNode extends LoggedScalarNode<NodeStateBase, 'done'> {
  readonly name = 'explicit-error-node';
  readonly outputs = ['done', 'error'] as const;

  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done':  { 'type': 'object' },
      'error': { 'type': 'object' },
    };
  }

  protected override async runOne(
    _state: NodeStateBase,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'done'>> {
    // Explicit routing to 'done' — the 'error' route is never taken here.
    // Shows the subclass can freely choose its output.
    return NodeOutputBuilder.of('done');
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void describe('LoggedScalarNode: (a) normal routing', () => {
  void it('routes to the declared output port when runOne returns normally', async () => {
    const node = new NormalNode();
    const state = new NodeStateBase();
    const routed = await NodeRunner.run(node, Batch.of(state), CTX);

    assert.ok(routed.has('done'), "result has 'done' port");
    assert.equal(routed.get('done')?.size, 1, "'done' batch has one item");
    assert.ok(!routed.has('error'), "no items routed to 'error'");
    assert.equal(state.errors.length, 0, 'no errors collected on state');
  });
});

void describe('LoggedScalarNode: (b) throw caught and routed (devMode: true)', () => {
  void it('surfaces a contract violation error when runOne throws (devMode: true)', async () => {
    const node = new ThrowingNode({ 'devMode': true });
    const state = new NodeStateBase();

    await assert.rejects(
      async () => NodeRunner.run(node, Batch.of(state), CTX),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'thrown value is an Error');
        assert.ok(
          err.message.includes('[LoggedScalarNode]'),
          'error is a LoggedScalarNode contract violation',
        );
        return true;
      },
    );
  });

  void it('collects a nodeContractViolation error onto state before re-throwing', async () => {
    const node = new ThrowingNode({ 'devMode': true });
    const state = new NodeStateBase();

    await assert.rejects(
      async () => NodeRunner.run(node, Batch.of(state), CTX),
    );

    assert.equal(state.errors.length, 1, 'one error collected on state');
    assert.equal(state.errors[0]?.['code'], 'nodeContractViolation', "error code is 'nodeContractViolation'");
  });
});

void describe('LoggedScalarNode: (c) contract error names the node', () => {
  void it('contract error message includes the offending node name', async () => {
    const node = new ThrowingNode({ 'devMode': true });
    const state = new NodeStateBase();

    const thrown = await NodeRunner.run(node, Batch.of(state), CTX).catch((e: unknown) => e);

    assert.ok(thrown instanceof Error, 'caught value is an Error');
    assert.ok(
      thrown.message.includes('throwing-node'),
      `contract error names the offending node; message: ${thrown.message}`,
    );
  });

  void it('collected error context carries nodeName', async () => {
    const node = new ThrowingNode({ 'devMode': true });
    const state = new NodeStateBase();

    await NodeRunner.run(node, Batch.of(state), CTX).catch(() => { /* expected */ });

    const err = state.errors[0];
    assert.ok(err !== undefined, 'error is present');
    assert.equal(
      (err['context'] as Record<string, unknown>)['nodeName'],
      'throwing-node',
      "error context.nodeName matches the node's registered name",
    );
  });
});

void describe('LoggedScalarNode: (d) throw caught silently (devMode: false)', () => {
  void it('routes to error, does not re-throw when devMode is false', async () => {
    const node = new ThrowingNode({ 'devMode': false });
    const state = new NodeStateBase();

    const routed = await NodeRunner.run(node, Batch.of(state), CTX);

    assert.ok(routed.has('error'), "result has 'error' port");
    assert.equal(routed.get('error')?.size, 1, "'error' batch has one item");
    assert.ok(!routed.has('done'), "no items routed to 'done'");
    assert.equal(state.errors.length, 1, 'one error collected on state');
    assert.equal(
      state.errors[0]?.['code'],
      'nodeContractViolation',
      "collected error code is 'nodeContractViolation'",
    );
  });
});

void describe('LoggedScalarNode: (e) explicit error routing', () => {
  void it('a subclass that routes to done normally produces no errors', async () => {
    const node = new ExplicitErrorNode();
    const state = new NodeStateBase();
    const routed = await NodeRunner.run(node, Batch.of(state), CTX);

    assert.ok(routed.has('done'), "result has 'done' port");
    assert.equal(state.errors.length, 0, 'no errors collected');
  });
});
