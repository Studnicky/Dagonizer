/**
 * 19-phase-nodes: PhaseNode placements — pre and post lifecycle wrapping.
 *
 * Demonstrates DAGBuilder.phase() to attach side-effect work that wraps the
 * main execution loop without participating in output-port routing:
 *
 *   pre  phase — declared with `.phase(placementIri, 'pre', node)`.
 *     Runs BEFORE the DAG entrypoint, in declaration order.
 *     An error thrown in a pre-phase aborts the run; the main loop never runs.
 *     Use cases: acquire resources, seed state, validate preconditions.
 *
 *   post phase — declared with `.phase(placementIri, 'post', node)`.
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

import { Dagonizer } from '@studnicky/dagonizer';
import { PhaseState, PreSetupNode, ComputeNode, PostAuditNode, dag, dagIri } from './dags/19-phase-nodes.js';

// ---------------------------------------------------------------------------
// Observability: subclass to tap phase boundaries
// ---------------------------------------------------------------------------

// #region phase-observer
class PhaseObserver extends Dagonizer<PhaseState> {
  readonly #events: string[] = [];

  get events(): readonly string[] { return this.#events; }

  protected override onPhaseEnter(_dagName: string, phase: 'pre' | 'post', placementName: string, _state: PhaseState, _placementPath: readonly string[]): void {
    this.#events.push(`enter:${phase}:${placementName}`);
  }

  protected override onPhaseExit(_dagName: string, phase: 'pre' | 'post', placementName: string, _state: PhaseState, _placementPath: readonly string[]): void {
    this.#events.push(`exit:${phase}:${placementName}`);
  }
}
// #endregion phase-observer

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<PhaseState>();
dispatcher.registerNode(new PreSetupNode());
dispatcher.registerNode(new ComputeNode());
dispatcher.registerNode(new PostAuditNode());
dispatcher.registerDAG(dag);

const state = new PhaseState();
const result = await dispatcher.execute(dagIri, state);

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

process.stdout.write('\n19-phase-nodes: pre/post phase wrapping\n\n');
process.stdout.write(`  lifecycle     = ${state.lifecycle.variant}\n`);
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

// ---------------------------------------------------------------------------
// Run: PhaseObserver (subclass that records phase enter/exit events)
// ---------------------------------------------------------------------------

const observer = new PhaseObserver();
observer.registerNode(new PreSetupNode());
observer.registerNode(new ComputeNode());
observer.registerNode(new PostAuditNode());
observer.registerDAG(dag);

const observedState = new PhaseState();
await observer.execute(dagIri, observedState);

process.stdout.write('\nPhaseObserver events:\n');
for (const ev of observer.events) {
  process.stdout.write(`  ${ev}\n`);
}
