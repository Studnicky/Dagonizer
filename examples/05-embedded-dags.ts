/**
 * 05-embedded-dags — ScatterNode singleton: nested DAG invocation with state mapping.
 *
 * Demonstrates how a parent DAG invokes a child (deep) DAG via a ScatterNode
 * with no `source` (the singleton pattern — exactly one clone). State mapping
 * controls data flow at the boundary:
 *   projection — copies named fields from parent state into the clone before
 *                the child DAG runs (`{ cloneField: parentPath }`).
 *   gather     — copies named fields from clone state back into parent state
 *                after the child DAG returns. Strategy `map` reads each clone
 *                field and writes to the parent path
 *                (`{ cloneField: parentPath }`).
 *
 * Watch: seed=41 enters the clone as payload=41, gets incremented to 42,
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
// State — fields live on the same class; projection / gather control which
// ones cross the ScatterNode clone boundary
// ---------------------------------------------------------------------------

class S extends NodeStateBase {
  seed    = 0;  // parent input value
  result  = 0;  // parent output value (written back via gather.mapping)
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
// Parent DAG — invokes the child via ScatterNode (singleton, no source)
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
      '@type': 'ScatterNode',                        // singleton — no source, one clone
      "name":    'invoke',
      "body":    { "dag": 'child' },                 // run the registered child DAG in the clone
      // #region state-mapping
      // projection: seeds clone fields from parent before the body runs
      // { cloneField: parentPath }
      "projection": { "payload": 'seed' },           // clone.payload ← parent.seed

      // gather: writes clone fields back to parent after the body returns
      // strategy 'map' reads each cloneField and writes the parentPath
      // { cloneField: parentPath }
      "gather": {
        "strategy": 'map',
        "mapping":  { "payload": 'result' },         // parent.result ← clone.payload
      },
      // #endregion state-mapping
      // Routes for the ScatterNode outcome (terminal reducer: success / error)
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

process.stdout.write('\nScatterNode singleton — parent → invoke(child) → END\n');
process.stdout.write(`  seed=${state.seed} → child DAG incremented payload → result=${state.result}\n`);
process.stdout.write('\nLesson: projection copies seed→payload into the clone;\n');
process.stdout.write('        gather.mapping copies payload→result back to parent.\n');
process.stdout.write('        ScatterNode with no source runs exactly one clone.\n');
// #endregion run
