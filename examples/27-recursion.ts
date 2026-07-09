/**
 * 27-recursion: a countdown DAG that recursively invokes ITSELF via
 * dynamic `DagReference` resolution.
 *
 * Each recursive frame:
 *   1. AccumulateNode adds `remaining` to `total`, then decrements to
 *      `nextRemaining`.
 *   2. Base case (remaining === 0): route to `base-end` terminal.
 *   3. Recursive case: EmbeddedDAGNode reads `state.dagIri` through a
 *      dynamic DagReference, spawns a fresh isolated child frame, seeds it with
 *      `remaining ← nextRemaining` and the carried `total`, executes the
 *      same `'countdown'` DAG, then maps the child's `total` back into the
 *      parent frame.
 *
 * Watch: countdown(5) → 5+4+3+2+1+0 = 15
 *
 * DAG definition: examples/dags/27-recursion.ts
 *
 * Run: npx tsx examples/27-recursion.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { CountdownState, AccumulateNode, countdownDAG } from './dags/27-recursion.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<CountdownState>();
dispatcher.registerNode(new AccumulateNode());
dispatcher.registerDAG(countdownDAG);

const state = new CountdownState();
state.remaining = 5;

const result = await dispatcher.execute('urn:noocodec:dag:countdown', state);

process.stdout.write('\nRecursive countdown via dynamic DagReference resolution\n');
process.stdout.write(`  remaining=5 → 5+4+3+2+1+0 = ${state.total}\n`);
process.stdout.write(`  terminalOutcome: ${result.terminalOutcome}\n`);
process.stdout.write('\nLesson: DagReference reads state.dagIri at runtime so the DAG\n');
process.stdout.write('        embeds itself — true recursion. Each frame runs on a\n');
process.stdout.write('        FRESH isolated child state; stateMapping.input seeds\n');
process.stdout.write('        the next frame and stateMapping.output carries the\n');
process.stdout.write('        accumulator back up the call stack.\n');
// #endregion run
