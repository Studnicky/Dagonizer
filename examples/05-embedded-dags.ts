/**
 * 05-embedded-dags — EmbeddedDAGNode: nested DAG invocation with state mapping.
 *
 * Demonstrates how a parent DAG invokes a child (deep) DAG via an
 * EmbeddedDAGNode. State mapping controls data flow at the boundary:
 *   inputs  — copies named fields from parent state into the child before
 *              the child DAG runs (`{ childKey: parentPath }`).
 *   outputs — copies named fields from child state back into parent state
 *              after the child DAG returns (`{ parentPath: childKey }`).
 *
 * Watch: seed=41 enters the child as payload=41, gets incremented to 42,
 * then maps back into parent state as result=42.
 *
 * Run: npx tsx examples/05-embedded-dags.ts
 */

import {
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State — fields live on the same class; inputs / outputs control which
// ones cross the EmbeddedDAGNode boundary
// ---------------------------------------------------------------------------

class S extends NodeStateBase {
  seed    = 0;  // parent input value
  result  = 0;  // parent output value (written back via stateMapping.outputs)
  payload = 0;  // the field the child DAG operates on
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// The child DAG's working node: increments the payload field
const increment: NodeInterface<S, 'success'> = {
  "name": 'increment',
  "outputs": ['success'],
  async execute(state) {
    state.payload = state.payload + 1;
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// Child (deep) DAG — runs the increment node then hands control back
// ---------------------------------------------------------------------------

// #region child-dag
const child: DAG = {
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
      "outputs": { "success": null },  // child DAG ends here — parent resumes after
    },
  ],
};
// #endregion child-dag

// ---------------------------------------------------------------------------
// Parent DAG — invokes the child via EmbeddedDAGNode (cardinality 1)
// ---------------------------------------------------------------------------

// #region parent-dag
const parent: DAG = {
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
      "outputs": { "success": null, "error": null },
    },
  ],
};
// #endregion parent-dag

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<S>();
dispatcher.registerNode(increment);
dispatcher.registerDAG(child);
dispatcher.registerDAG(parent);

const state = new S();
state.seed = 41;
await dispatcher.execute('parent', state);

process.stdout.write('\nEmbeddedDAGNode — parent → invoke(child) → END\n');
process.stdout.write(`  seed=${state.seed} → child DAG incremented payload → result=${state.result}\n`);
process.stdout.write('\nLesson: stateMapping.input copies seed→payload into the child;\n');
process.stdout.write('        stateMapping.output copies payload→result back to parent.\n');
process.stdout.write('        EmbeddedDAGNode always runs exactly one child execution.\n');
// #endregion run
