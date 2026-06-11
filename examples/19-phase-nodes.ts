/**
 * 19-phase-nodes: PhaseNode placements — pre and post lifecycle wrapping.
 *
 * Demonstrates DAGBuilder.phase() to attach side-effect work that wraps the
 * main execution loop without participating in output-port routing:
 *
 *   pre  phase — declared with `.phase('name', 'pre', node)`.
 *     Runs BEFORE the DAG entrypoint, in declaration order.
 *     An error thrown in a pre-phase aborts the run; the main loop never runs.
 *     Use cases: acquire resources, seed state, validate preconditions.
 *
 *   post phase — declared with `.phase('name', 'post', node)`.
 *     Runs AFTER the main loop drains, on every exit path (completion, abort,
 *     timeout, terminal-failed, or node throw). Errors are collected as
 *     warnings on state; they do NOT change the already-set lifecycle.
 *     Use cases: flush metrics, release locks, audit final state.
 *
 * Watch: executionLog proves the ordering guarantee:
 *   pre-setup → compute → post-audit → final-result:computed:84
 *
 * DAG definition (state, nodes, dag): examples/dags/19-phase-nodes.ts
 *
 * Run: npx tsx examples/19-phase-nodes.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import { PhaseState, preSetup, compute, postAudit, dag } from './dags/19-phase-nodes.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<PhaseState>();
dispatcher.registerNode(preSetup);
dispatcher.registerNode(compute);
dispatcher.registerNode(postAudit);
dispatcher.registerDAG(dag);

const state = new PhaseState();
const result = await dispatcher.execute('phase-demo', state);

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

process.stdout.write('\n19-phase-nodes: pre/post phase wrapping\n\n');
process.stdout.write(`  lifecycle     = ${state.lifecycle.kind}\n`);
process.stdout.write(`  seedValue     = ${String(state.seedValue)}  (set by pre-setup)\n`);
process.stdout.write(`  result        = ${state.result}  (set by compute)\n`);
process.stdout.write(`  executedNodes = ${result.executedNodes.join(', ')}\n`);
process.stdout.write('\n  Execution order (from executionLog):\n');
for (const entry of state.executionLog) {
  process.stdout.write(`    ${entry}\n`);
}
process.stdout.write('\nLesson: .phase("name", "pre", node)  runs before the entrypoint.\n');
process.stdout.write('        .phase("name", "post", node) runs after every exit path.\n');
process.stdout.write('        Phase nodes have no output ports; they mutate state in place.\n');
process.stdout.write('        A pre-phase error aborts the run; a post-phase error is a warning.\n');
