/**
 * 09-terminals/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/09-terminals.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  DAGBuilder,
  DAGIdentity,
  MonadicNode,
  NodeError,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

const completedDagIri = 'urn:noocodec:dag:demo-explicit-completed' as const;
const explicitTerminalsDagIri = 'urn:noocodec:dag:demo-explicit-terminals' as const;
const explicitFailedDagIri = 'urn:noocodec:dag:demo-explicit-failed' as const;
const childTerminalsDagIri = 'urn:noocodec:dag:child-for-terminals' as const;
const embeddedTerminalsDagIri = 'urn:noocodec:dag:demo-embedded-dag-terminals' as const;
const placement = (dagIri: string, placementIdentifier: string): string =>
  DAGIdentity.placementId(dagIri, placementIdentifier);

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
  readonly '@id' = 'urn:noocodec:node:step-a';
  readonly outputs = ['ok'] as const;
  override get outputSchema(): Record<'ok', SchemaObjectType> {
    return { 'ok': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GateState>) {
    return RoutedBatch.create(NodeOutput.create('ok').output, batch);
  }
}

export class CheckNode extends MonadicNode<GateState, 'pass' | 'fail'> {
  readonly name = 'check';
  readonly '@id' = 'urn:noocodec:node:check';
  readonly outputs = ['pass', 'fail'] as const;
  override get outputSchema(): Record<'pass' | 'fail', SchemaObjectType> {
    return { 'pass': { 'type': 'object' }, 'fail': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GateState>) {
    const entries: Array<readonly ['pass' | 'fail', Batch<GateState>]> = [];
    for (const item of batch) {
      const output = NodeOutput.create(item.state.shouldPass ? 'pass' : 'fail');
      entries.push([output.output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

// Child DAG work node: used in pattern 3. Reads `shouldPass`, which the
// ScatterNode projection seeds onto the clone from parent state before the
// child DAG body runs (a state clone carries metadata, not subclass fields;
// projection is how parent data reaches the clone).
export class ChildWorkNode extends MonadicNode<GateState, 'done'> {
  readonly name = 'child-work';
  readonly '@id' = 'urn:noocodec:node:child-work';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { 'done': { 'type': 'object' } };
  }

  override async execute(batch: Batch<GateState>) {
    for (const item of batch) {
      if (!item.state.shouldPass) {
        item.state.collectError(NodeError.create(
          'CHILD_ERR',
          'child-work failed deliberately',
          'child-work',
          false,
          new Date().toISOString(),
        ));
      }
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Pattern 1: Explicit completed terminal
// ---------------------------------------------------------------------------

// #region terminal-completed
export const dag1 = new DAGBuilder(completedDagIri, '1')
  .node(placement(completedDagIri, 'step-a'), new StepANode(), {
    'ok': placement(completedDagIri, 'end'),
  })
  .terminal(placement(completedDagIri, 'end'))  // outcome defaults to 'completed'
  .build();
// #endregion terminal-completed

// ---------------------------------------------------------------------------
// Pattern 2: Explicit failed terminal (two terminals)
// ---------------------------------------------------------------------------

// #region terminal-failed
export const dag2 = new DAGBuilder(explicitTerminalsDagIri, '1')
  .node(placement(explicitTerminalsDagIri, 'check'), new CheckNode(), {
    'pass': placement(explicitTerminalsDagIri, 'end-ok'),
    'fail': placement(explicitTerminalsDagIri, 'end-fail'),
  })
  .terminal(placement(explicitTerminalsDagIri, 'end-ok'))
  .terminal(placement(explicitTerminalsDagIri, 'end-fail'), { outcome: 'failed' })
  .build();
// #endregion terminal-failed

// ---------------------------------------------------------------------------
// Pattern 3: Single explicit failed terminal
// ---------------------------------------------------------------------------

// #region terminal-single-failed
// A node that always routes 'fail' to a TerminalNode whose outcome is 'failed'.
// Demonstrates the minimal single-terminal failed pattern (as opposed to dag2
// which shows the dual-terminal pass/fail case).
export const dag3 = new DAGBuilder(explicitFailedDagIri, '1')
  .node(placement(explicitFailedDagIri, 'check'), new CheckNode(), {
    'pass': placement(explicitFailedDagIri, 'end-ok'),
    'fail': placement(explicitFailedDagIri, 'end-fail'),
  })
  .terminal(placement(explicitFailedDagIri, 'end-ok'))
  .terminal(placement(explicitFailedDagIri, 'end-fail'), { outcome: 'failed' })
  .build();
// #endregion terminal-single-failed

// ---------------------------------------------------------------------------
// Pattern 4: EmbeddedDAGNode routing to explicit terminals
// ---------------------------------------------------------------------------

// #region embedded-terminals
// Child DAG literal: routes 'done' to a TerminalNode (well-formed).
export const childDAG: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': childTerminalsDagIri,
  '@type':     'DAG',
  "name":      'child-for-terminals',
  "version":   '1',
  "entrypoints": { "main": placement(childTerminalsDagIri, 'child-work') },
  "nodes": [
    {
      '@id': 'urn:noocodec:dag:child-for-terminals/node/child-work',
      '@type':  'SingleNode',
      "name":   'child-work',
      "node":   'urn:noocodec:node:child-work',
      "outputs": { "done": placement(childTerminalsDagIri, 'child-end') },
    },
    {
      '@id': 'urn:noocodec:dag:child-for-terminals/node/child-end',
      '@type':   'TerminalNode',
      "name":    'child-end',
      "outcome": 'completed',
    },
  ],
};

export const dag4 = new DAGBuilder(embeddedTerminalsDagIri, '1')
  .embed<GateState, GateState>(placement(embeddedTerminalsDagIri, 'run'), childTerminalsDagIri, {
    'success': placement(embeddedTerminalsDagIri, 'end-ok'),
    'error':   placement(embeddedTerminalsDagIri, 'end-fail'),
  }, {
    // Seed the child's shouldPass from parent state before the child DAG runs.
    'inputs': { 'shouldPass': 'shouldPass' },
  })
  .terminal(placement(embeddedTerminalsDagIri, 'end-ok'))
  .terminal(placement(embeddedTerminalsDagIri, 'end-fail'), { outcome: 'failed' })
  .build();
// #endregion embedded-terminals
