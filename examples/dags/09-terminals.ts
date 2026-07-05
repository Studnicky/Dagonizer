/**
 * 09-terminals/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/09-terminals.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  DAGBuilder,
  MonadicNode,
  NodeErrorBuilder,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class GateState extends NodeStateBase {
  shouldPass = true;  // controls which terminal the check node routes to
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export class StepANode extends MonadicNode<GateState, 'ok'> {
  readonly name = 'step-a';
  readonly outputs = ['ok'] as const;
  override get outputSchema(): Record<'ok', SchemaObjectType> {
    return { 'ok': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GateState>) {
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('ok').output, batch);
  }
}

export class CheckNode extends MonadicNode<GateState, 'pass' | 'fail'> {
  readonly name = 'check';
  readonly outputs = ['pass', 'fail'] as const;
  override get outputSchema(): Record<'pass' | 'fail', SchemaObjectType> {
    return { 'pass': { 'type': 'object' }, 'fail': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GateState>) {
    const entries: Array<readonly ['pass' | 'fail', Batch<GateState>]> = [];
    for (const item of batch) {
      const output = NodeOutputBuilder.of(item.state.shouldPass ? 'pass' : 'fail');
      entries.push([output.output, Batch.from([item])]);
    }
    return RoutedBatchBuilder.from(entries);
  }
}

// Child DAG work node: used in pattern 3. Reads `shouldPass`, which the
// ScatterNode projection seeds onto the clone from parent state before the
// child DAG body runs (a state clone carries metadata, not subclass fields;
// projection is how parent data reaches the clone).
export class ChildWorkNode extends MonadicNode<GateState, 'done'> {
  readonly name = 'child-work';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GateState>) {
    for (const item of batch) {
      if (!item.state.shouldPass) {
        item.state.collectError(NodeErrorBuilder.from(
          'CHILD_ERR',
          'child-work failed deliberately',
          'child-work',
          false,
          new Date().toISOString(),
        ));
      }
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Pattern 1: Explicit completed terminal
// ---------------------------------------------------------------------------

// #region terminal-completed
export const dag1 = new DAGBuilder('demo-explicit-completed', '1')
  .node('step-a', new StepANode(), { 'ok': 'end' })
  .terminal('end')  // outcome defaults to 'completed'
  .build();
// #endregion terminal-completed

// ---------------------------------------------------------------------------
// Pattern 2: Explicit failed terminal (two terminals)
// ---------------------------------------------------------------------------

// #region terminal-failed
export const dag2 = new DAGBuilder('demo-explicit-terminals', '1')
  .node('check', new CheckNode(), { 'pass': 'end-ok', 'fail': 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', { outcome: 'failed' })
  .build();
// #endregion terminal-failed

// ---------------------------------------------------------------------------
// Pattern 3: Single explicit failed terminal
// ---------------------------------------------------------------------------

// #region terminal-single-failed
// A node that always routes 'fail' to a TerminalNode whose outcome is 'failed'.
// Demonstrates the minimal single-terminal failed pattern (as opposed to dag2
// which shows the dual-terminal pass/fail case).
export const dag3 = new DAGBuilder('demo-explicit-failed', '1')
  .node('check', new CheckNode(), { 'pass': 'end-ok', 'fail': 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', { outcome: 'failed' })
  .build();
// #endregion terminal-single-failed

// ---------------------------------------------------------------------------
// Pattern 4: EmbeddedDAGNode routing to explicit terminals
// ---------------------------------------------------------------------------

// #region embedded-terminals
// Child DAG literal: routes 'done' to a TerminalNode (well-formed).
export const childDAG: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:child-for-terminals',
  '@type':     'DAG',
  "name":      'child-for-terminals',
  "version":   '1',
  "entrypoint": 'child-work',
  "nodes": [
    {
      '@id':    'urn:noocodex:dag:child-for-terminals/node/child-work',
      '@type':  'SingleNode',
      "name":   'child-work',
      "node":   'child-work',
      "outputs": { "done": 'child-end' },
    },
    {
      '@id':     'urn:noocodex:dag:child-for-terminals/node/child-end',
      '@type':   'TerminalNode',
      "name":    'child-end',
      "outcome": 'completed',
    },
  ],
};

export const dag4 = new DAGBuilder('demo-embedded-dag-terminals', '1')
  .embeddedDAG<GateState, GateState>('run', 'child-for-terminals', {
    'success': 'end-ok',
    'error':   'end-fail',
  }, {
    // Seed the child's shouldPass from parent state before the child DAG runs.
    'inputs': { 'shouldPass': 'shouldPass' },
  })
  .terminal('end-ok')
  .terminal('end-fail', { outcome: 'failed' })
  .build();
// #endregion embedded-terminals
