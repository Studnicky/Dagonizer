/**
 * 07-retry-placement/dags: declarative per-placement retry.
 *
 * Demonstrates declaring retry behaviour on the placement in the DAG schema
 * via `DAGBuilder.node(..., { retry: { ... } })`, so the engine automatically
 * re-fires the node on throw without requiring hand-rolled retry logic inside
 * the node.
 *
 * Placement-level retry is an opt-in complement to the state.withinRetryBudget()
 * loop-edge pattern. Use placement retry for transient infrastructure failures
 * (network calls, rate limits) where the node itself need not be aware of retrying.
 *
 * Imported by examples/07-retry-placement-run.ts (the executable entry point).
 */

import { DAGBuilder, NodeOutputBuilder, NodeStateBase, ScalarNode } from '@studnicky/dagonizer';
import type { NodeContextType, NodeOutputType, SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class ClassifyState extends NodeStateBase {
  result = '';
}

// ---------------------------------------------------------------------------
// Flaky node: throws on the first two attempts, succeeds on the third.
// The node itself does NOT contain retry logic — that lives on the placement.
// ---------------------------------------------------------------------------

export class FlakyClassifyNode extends ScalarNode<ClassifyState, 'success' | 'error'> {
  readonly name = 'classify';
  readonly outputs = ['success', 'error'] as const;

  #attempts = 0;

  get attempts(): number { return this.#attempts; }

  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }

  protected override async executeOne(
    state: ClassifyState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'error'>> {
    this.#attempts++;
    if (this.#attempts < 3) {
      // Throw — the engine catches this and applies the placement retry policy.
      throw new Error('transient classification failure');
    }
    state.result = 'classified';
    return NodeOutputBuilder.of('success');
  }
}

// ---------------------------------------------------------------------------
// DAG: placement-level retry declared on the 'classify' node.
// The engine re-fires the node up to 3 times with constant 0ms backoff.
// ---------------------------------------------------------------------------

// #region placement-retry-dag
export const classifyNode = new FlakyClassifyNode();

export const dag = new DAGBuilder('classify-with-retry', '1.0')
  .node(
    'classify',
    classifyNode,
    { 'success': 'end', 'error': 'end-error' },
    {
      retry: {
        maxAttempts:  3,
        strategy:     'constant',
        baseDelay:    0,      // instant in tests; use real delays in production
        jitterFactor: 0,
      },
    },
  )
  .terminal('end')
  .terminal('end-error', { outcome: 'failed' })
  .build();
// #endregion placement-retry-dag
