/**
 * 05-embedded-dags/dags: pure module — state, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/05-embedded-dags.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// State: fields live on the same class; inputs / outputs control which
// ones cross the EmbeddedDAGNode boundary
// ---------------------------------------------------------------------------

export class IncrementState extends NodeStateBase {
  seed    = 0;  // parent input value
  result  = 0;  // parent output value (written back via stateMapping.outputs)
  payload = 0;  // the field the child DAG operates on
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// The child DAG's working node: increments the payload field
export const increment: NodeInterface<IncrementState, 'success'> = {
  "name": 'increment',
  "outputs": ['success'],
  async execute(state) {
    state.payload = state.payload + 1;
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// Child (deep) DAG: runs the increment node then hands control back
// ---------------------------------------------------------------------------

// #region child-dag
export const child: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:child',
  '@type':     'DAG',
  "name":        'child',
  "version":     '1',
  "entrypoint":  'inc',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:child/node/inc',
      '@type': 'SingleNode',
      "name":    'inc',
      "node":    'increment',
      "outputs": { "success": 'child-end' },  // child DAG ends at TerminalNode
    },
    {
      '@id':     'urn:noocodex:dag:child/node/child-end',
      '@type':   'TerminalNode',
      "name":    'child-end',
      "outcome": 'completed',
    },
  ],
};
// #endregion child-dag

// ---------------------------------------------------------------------------
// Parent DAG: invokes the child via EmbeddedDAGNode (cardinality 1)
// ---------------------------------------------------------------------------

// #region parent-dag
export const parent: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:parent',
  '@type':     'DAG',
  "name":        'parent',
  "version":     '1',
  "entrypoint":  'invoke',
  "nodes": [
    {
      '@id':   'urn:noocodex:dag:parent/node/invoke',
      '@type': 'EmbeddedDAGNode',              // nested DAG invocation, cardinality 1
      "name":    'invoke',
      "dag":     'child',                       // run the registered child DAG
      // #region state-mapping
      // stateMapping: seeds child fields from parent, and copies child fields back
      "stateMapping": {
        // inputs: seeds child state before the body runs
        // { childKey: parentPath }
        "input":  { "payload": 'seed' },        // child.payload ← parent.seed

        // outputs: writes child fields back to parent after the body returns
        // { parentPath: childKey }
        "output": { "result": 'payload' },       // parent.result ← child.payload
      },
      // #endregion state-mapping
      // Routes for the EmbeddedDAGNode outcome (success / error)
      "outputs": { "success": 'end', "error": 'end-error' },
    },
    {
      '@id':     'urn:noocodex:dag:parent/node/end',
      '@type':   'TerminalNode',
      "name":    'end',
      "outcome": 'completed',
    },
    {
      '@id':     'urn:noocodex:dag:parent/node/end-error',
      '@type':   'TerminalNode',
      "name":    'end-error',
      "outcome": 'failed',
    },
  ],
};
// #endregion parent-dag
