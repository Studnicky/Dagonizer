/**
 * 09-terminals/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/09-terminals.ts (the executable entry point).
 *
 * NOTE: dag1 deliberately retains a bare null route to demonstrate the
 * implicit-terminal pattern. It is excluded from the lint-example-dags
 * registry so the linter can flag null routes everywhere else.
 */

import {
  DAG_CONTEXT,
  DAGBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class S extends NodeStateBase {
  shouldPass = true;  // controls which terminal the check node routes to
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const stepA: NodeInterface<S, 'ok'> = {
  "name":    'step-a',
  "outputs": ['ok'],
  async execute(_state) {
    return { "output": 'ok' };
  },
};

export const checkNode: NodeInterface<S, 'pass' | 'fail'> = {
  "name":    'check',
  "outputs": ['pass', 'fail'],
  async execute(state) {
    return { "output": state.shouldPass ? 'pass' : 'fail' };
  },
};

// Child DAG work node: used in pattern 4. Reads `shouldPass`, which the
// ScatterNode projection seeds onto the clone from parent state before the
// child DAG body runs (a state clone carries metadata, not subclass fields;
// projection is how parent data reaches the clone).
export const childWork: NodeInterface<S, 'done'> = {
  "name":    'child-work',
  "outputs": ['done'],
  async execute(state) {
    if (!state.shouldPass) {
      state.collectError({
        "message":     'child-work failed deliberately',
        "code":        'CHILD_ERR',
        "operation":   'child-work',
        "recoverable": false,
        "timestamp":   new Date().toISOString(),
      });
    }
    return { "output": 'done' };
  },
};

// ---------------------------------------------------------------------------
// Pattern 1: Implicit terminal via null route
//
// NOTE: dag1 deliberately retains a bare null route to demonstrate the
// implicit-terminal pattern. It is excluded from the lint-example-dags
// registry so the linter can flag null routes everywhere else.
// ---------------------------------------------------------------------------

// #region null-route
export const dag1 = new DAGBuilder('demo-null-route', '1')
  .node('step-a', stepA, { 'ok': null })
  .build();
// #endregion null-route

// ---------------------------------------------------------------------------
// Pattern 2: Explicit completed terminal
// ---------------------------------------------------------------------------

// #region terminal-completed
export const dag2 = new DAGBuilder('demo-explicit-completed', '1')
  .node('step-a', stepA, { 'ok': 'end' })
  .terminal('end')  // outcome defaults to 'completed'
  .build();
// #endregion terminal-completed

// ---------------------------------------------------------------------------
// Pattern 3: Explicit failed terminal (two terminals)
// ---------------------------------------------------------------------------

// #region terminal-failed
export const dag3 = new DAGBuilder('demo-explicit-terminals', '1')
  .node('check', checkNode, { 'pass': 'end-ok', 'fail': 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
// #endregion terminal-failed

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
  .embeddedDAG<S, S>('run', 'child-for-terminals', {
    'success': 'end-ok',
    'error':   'end-fail',
  }, {
    // Seed the child's shouldPass from parent state before the child DAG runs.
    'inputs': { 'shouldPass': 'shouldPass' },
  })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
// #endregion embedded-terminals
