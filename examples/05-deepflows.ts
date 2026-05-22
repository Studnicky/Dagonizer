/**
 * 05-deepflows — DeepDAGNode: nested DAG invocation with state mapping.
 *
 * Demonstrates how a parent DAG can invoke a child (deep) DAG via
 * DeepDAGNode. State mapping controls data flow at the boundary:
 *   stateMapping.input  — copies named fields from parent state into the
 *                         child state before the deep-DAG runs.
 *   stateMapping.output — copies named fields from child state back into
 *                         parent state after the deep-DAG returns.
 *
 * The deep-DAG MUST NOT route any output to null directly — the parent DAG
 * owns the terminal transition. Structure: deep-DAG placement routes its
 * output to a parent-level terminal node that routes to null.
 *
 * Watch: seed=41 enters the deep-DAG as payload=41, gets incremented to 42,
 * then maps back into parent state as result=42.
 *
 * Run: npx tsx examples/05-deepflows.ts
 */

import {
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State — fields live on the same class; mapping controls which ones cross
// the deep-DAG boundary
// ---------------------------------------------------------------------------

class S extends NodeStateBase {
  seed    = 0;  // parent input value
  result  = 0;  // parent output value (written back via stateMapping.output)
  payload = 0;  // the field the deep-DAG operates on
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

// The deep-DAG's working node: increments the payload field
const increment: NodeInterface<S, 'success'> = {
  "name": 'increment',
  "outputs": ['success'],
  async execute(state) {
    state.payload = state.payload + 1;
    return { "output": 'success' };
  },
};

// Terminal node in the parent DAG — a minimal noop that ends the flow.
// Required because the parent owns the END transition; the deep-DAG
// placement cannot route directly to null.
const done: NodeInterface<S, 'success'> = {
  "name": 'done',
  "outputs": ['success'],
  async execute(_state) {
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// Child (deep) DAG — runs the increment node then hands control back
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Parent DAG — invokes the child via DeepDAGNode, then terminates via 'finish'
// ---------------------------------------------------------------------------

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
      '@type': 'DeepDAGNode',                       // invoke a nested (deep) DAG
      "name":    'invoke',
      "dag":     'child',                             // name of the registered child DAG
      "stateMapping": {
        // input: maps parent fields → child fields before the deep-DAG starts
        // { childField: parentField }
        "input":  { "payload": 'seed' },                // child.payload ← parent.seed

        // output: maps child fields → parent fields after the deep-DAG ends
        // { parentField: childField }
        "output": { "result": 'payload' },              // parent.result ← child.payload
      },
      // Routes for the deep-DAG outcome; parent terminates via 'finish'
      "outputs": { "success": 'finish', "error": 'finish' },
    },
    {
      '@id':   'urn:noocodex:dag:parent/node/finish',
      '@type': 'SingleNode',                        // terminal node — routes to null
      "name":    'finish',
      "node":    'done',
      "outputs": { "success": null },
    },
  ],
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<S>();
dispatcher.registerNode(increment);
dispatcher.registerNode(done);
dispatcher.registerDAG(child);
dispatcher.registerDAG(parent);

const state = new S();
state.seed = 41;
await dispatcher.execute('parent', state);

process.stdout.write('\nDeep-DAG — parent → invoke(child) → finish → END\n');
process.stdout.write(`  seed=${state.seed} → deep-DAG incremented payload → result=${state.result}\n`);
process.stdout.write('\nLesson: stateMapping.input copies seed→payload into the child;\n');
process.stdout.write('        stateMapping.output copies payload→result back to parent.\n');
process.stdout.write('        Parent owns END: deep-DAG routes to a terminal SingleNode.\n');
