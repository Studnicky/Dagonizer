/**
 * 09-terminals/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/09-terminals.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  DAGBuilder,
  NodeErrorBuilder,
  NodeOutputBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class GateState extends NodeStateBase {
  shouldPass = true;  // controls which terminal the check node routes to
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const stepA: NodeInterface<GateState, 'ok'> = {
  "name":    'step-a',
  "outputs": ['ok'],
  async execute(_state) {
    return NodeOutputBuilder.of('ok');
  },
};

export const checkNode: NodeInterface<GateState, 'pass' | 'fail'> = {
  "name":    'check',
  "outputs": ['pass', 'fail'],
  async execute(state) {
    return NodeOutputBuilder.of(state.shouldPass ? 'pass' : 'fail');
  },
};

// Child DAG work node: used in pattern 3. Reads `shouldPass`, which the
// ScatterNode projection seeds onto the clone from parent state before the
// child DAG body runs (a state clone carries metadata, not subclass fields;
// projection is how parent data reaches the clone).
export const childWork: NodeInterface<GateState, 'done'> = {
  "name":    'child-work',
  "outputs": ['done'],
  async execute(state) {
    if (!state.shouldPass) {
      state.collectError(NodeErrorBuilder.from(
        'CHILD_ERR',
        'child-work failed deliberately',
        'child-work',
        false,
        new Date().toISOString(),
      ));
    }
    return NodeOutputBuilder.of('done');
  },
};

// ---------------------------------------------------------------------------
// Pattern 1: Explicit completed terminal
// ---------------------------------------------------------------------------

// #region terminal-completed
export const dag1 = new DAGBuilder('demo-explicit-completed', '1')
  .node('step-a', stepA, { 'ok': 'end' })
  .terminal('end')  // outcome defaults to 'completed'
  .build();
// #endregion terminal-completed

// ---------------------------------------------------------------------------
// Pattern 2: Explicit failed terminal (two terminals)
// ---------------------------------------------------------------------------

// #region terminal-failed
export const dag2 = new DAGBuilder('demo-explicit-terminals', '1')
  .node('check', checkNode, { 'pass': 'end-ok', 'fail': 'end-fail' })
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
  .node('check', checkNode, { 'pass': 'end-ok', 'fail': 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', { outcome: 'failed' })
  .build();
// #endregion terminal-single-failed

// ---------------------------------------------------------------------------
// Pattern 4: EmbeddedDAGNode routing to explicit terminals
// ---------------------------------------------------------------------------

// #region embedded-terminals
// Child DAG literal: routes 'done' to a TerminalNode (well-formed).
export const childDAG: DAG = {
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
