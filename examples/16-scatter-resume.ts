/**
 * 16-scatter-resume: scatter durable-inbox checkpoint and resume.
 *
 * The scatter engine uses a durable-inbox model to survive crashes:
 *
 *   1. When an item is pulled from the source it enters the `inbox`
 *      (persisted in state metadata under SCATTER_PROGRESS_KEY).
 *   2. When the body completes successfully the item leaves the inbox and
 *      moves to `ackedResults`.
 *   3. On abort, the checkpoint captures both inbox and ackedResults.
 *   4. On resume, inbox items are reprocessed first (they may not have
 *      finished), then the remaining source items continue from where the
 *      iterator left off. Acked items are NEVER re-executed.
 *
 * The worker node fires the AbortController after a fixed number of body
 * invocations so the abort happens INSIDE the running scatter (between item
 * ack and the next pull). This is deterministic and credential-free.
 *
 * concurrency=1 so the abort fires cleanly between items:
 *
 *   Items 0–(ABORT_AFTER-1): run, ack, accumulate in ackedResults.
 *   Item ABORT_AFTER: node body fires abort → scatter pull loop exits
 *                     before pulling the next item → scatter throws.
 *   Items after abort: never pulled. Resume runs them fresh.
 *
 * Watch: execLog shows DIFFERENT labels for Run 1 vs Run 2 items, and
 *        the union of both logs covers all jobs with no duplicates.
 *
 * DAG definitions: examples/dags/16-scatter-resume.ts
 *
 * Run: npx tsx examples/16-scatter-resume.ts
 */

import {
  Checkpoint,
  CheckpointRestoreAdapter,
  Dagonizer,
  SCATTER_PROGRESS_KEY,
} from '@studnicky/dagonizer';

import {
  ResumeState,
  ProcessJobNode,
  dag,
  observable,
} from './dags/16-scatter-resume.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<ResumeState>();
dispatcher.registerNode(new ProcessJobNode());
dispatcher.registerDAG(dag);

const JOBS = ['job-A', 'job-B', 'job-C', 'job-D', 'job-E'];

// The node body will abort the controller after this many invocations in run 1.
// This ensures the abort fires INSIDE the scatter (between ack and next pull),
// not after all items have already completed.
const ABORT_AFTER = 2;

// ---------------------------------------------------------------------------
// Run 1: start, node-triggered abort mid-scatter
// ---------------------------------------------------------------------------

// #region run1
process.stdout.write('\n=== Run 1: scatter with mid-flight abort (after item 2) ===\n');

const ctl = new AbortController();

// Wire the abort trigger into the observable so the node can fire it.
observable.run        = 1;
observable.abortAfter = ABORT_AFTER;
observable.controller = ctl;

const state = new ResumeState();
state.jobs  = [...JOBS];

// await execution directly; the scatter yields once (for the scatter placement).
const partial = await dispatcher.execute('scatter-resume', state, { "signal": ctl.signal });

process.stdout.write(`  cursor: "${partial.cursor}"  (scatter placement awaits resume)\n`);
process.stdout.write(`  completed after run-1: ${JSON.stringify(state.completed)}\n`);
process.stdout.write(`  bodies run in run-1: ${JSON.stringify(observable.execLog)}\n`);

// Inspect the scatter checkpoint persisted in metadata.
const rawProgress = state.getMetadata(SCATTER_PROGRESS_KEY);
process.stdout.write(`  scatter progress stored in metadata: ${rawProgress !== undefined ? 'yes' : 'no'}\n`);
// #endregion run1

// ---------------------------------------------------------------------------
// Checkpoint capture + restore
// ---------------------------------------------------------------------------

// #region checkpoint
process.stdout.write('\n--- Checkpoint capture + restore ---\n');

// Snapshot the state (scatter progress is in metadata and captured automatically).
const ckpt      = await Checkpoint.capture('scatter-resume', partial);
const persisted  = ckpt.toJson();

// Simulate process restart: parse the JSON and restore typed state.
const restored  = Checkpoint.load(JSON.parse(persisted));
const { state: resumedState, cursor } = restored.restoreState(
  CheckpointRestoreAdapter.wrap((snap) => ResumeState.restore(snap)),
);

process.stdout.write(`  cursor restored to: "${cursor}"\n`);
process.stdout.write(`  completed in restored state: ${JSON.stringify(resumedState.completed)}\n`);
const restoredProgress = resumedState.getMetadata(SCATTER_PROGRESS_KEY);
process.stdout.write(`  scatter checkpoint in restored state: ${restoredProgress !== undefined ? 'yes' : 'no'}\n`);
// #endregion checkpoint

// ---------------------------------------------------------------------------
// Run 2: resume from cursor
// ---------------------------------------------------------------------------

// #region run2
process.stdout.write('\n=== Run 2: resume from cursor ===\n');

observable.run        = 2;
observable.abortAfter = 0;       // no abort in run 2
observable.controller = null;    // clear controller

await dispatcher.resume('scatter-resume', resumedState, cursor);

process.stdout.write(`  completed after resume: ${JSON.stringify(resumedState.completed)}\n`);
process.stdout.write(`  bodies run in run-2: ${JSON.stringify(observable.execLog.filter((e) => e.includes('run-2')))}\n`);
// #endregion run2

// ---------------------------------------------------------------------------
// Verification: no double-processing
// ---------------------------------------------------------------------------

// #region verify
process.stdout.write('\n--- Verification ---\n');

const run1Bodies = observable.execLog.filter((e) => e.includes('run-1'));
const run2Bodies = observable.execLog.filter((e) => e.includes('run-2'));

process.stdout.write(`  run-1 bodies: ${JSON.stringify(run1Bodies)}\n`);
process.stdout.write(`  run-2 bodies: ${JSON.stringify(run2Bodies)}\n`);

const run1Jobs = new Set(run1Bodies.map((e) => e.split('(')[0] ?? ''));
const run2Jobs = new Set(run2Bodies.map((e) => e.split('(')[0] ?? ''));
const overlaps = [...run1Jobs].filter((j) => run2Jobs.has(j));
process.stdout.write(`  double-processed: ${overlaps.length === 0 ? 'none (correct)' : JSON.stringify(overlaps)}\n`);

const allProcessed = new Set([...run1Jobs, ...run2Jobs]);
const missing = JOBS.filter((j) => !allProcessed.has(j));
process.stdout.write(`  all ${JOBS.length} jobs covered: ${missing.length === 0 ? 'yes' : `no, missing: ${JSON.stringify(missing)}`}\n`);

process.stdout.write('\n--- Lesson ---\n');
process.stdout.write('Acked items (completed before abort) are skipped on resume: no re-execution.\n');
process.stdout.write('Remaining source items (not yet pulled) run fresh in the resumed scatter.\n');
process.stdout.write('Inbox items (pulled-but-not-acked at crash time) are reprocessed first on resume.\n');
process.stdout.write('Together: every job executes exactly once across the two runs.\n');
// #endregion verify
