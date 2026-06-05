/**
 * 05-embedded-dags: EmbeddedDAGNode nested DAG invocation with state mapping.
 *
 * Demonstrates how a parent DAG invokes a child (deep) DAG via an
 * EmbeddedDAGNode. State mapping controls data flow at the boundary:
 *   inputs: copies named fields from parent state into the child before
 *           the child DAG runs (`{ childKey: parentPath }`).
 *   outputs: copies named fields from child state back into parent state
 *            after the child DAG returns (`{ parentPath: childKey }`).
 *
 * Watch: seed=41 enters the child as payload=41, gets incremented to 42,
 * then maps back into parent state as result=42.
 *
 * DAG definition (state, increment node, child/parent dags): examples/dags/05-embedded-dags.ts
 *
 * Run: npx tsx examples/05-embedded-dags.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import { IncrementState, increment, child, parent } from './dags/05-embedded-dags.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<IncrementState>();
dispatcher.registerNode(increment);
dispatcher.registerDAG(child);
dispatcher.registerDAG(parent);

const state = new IncrementState();
state.seed = 41;
await dispatcher.execute('parent', state);

process.stdout.write('\nEmbeddedDAGNode: parent -> invoke(child) -> END\n');
process.stdout.write(`  seed=${state.seed} → child DAG incremented payload → result=${state.result}\n`);
process.stdout.write('\nLesson: stateMapping.input copies seed→payload into the child;\n');
process.stdout.write('        stateMapping.output copies payload→result back to parent.\n');
process.stdout.write('        EmbeddedDAGNode always runs exactly one child execution.\n');
// #endregion run
