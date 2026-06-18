/**
 * 23-checkpoint-store: persist a mid-run checkpoint to MemoryCheckpointStore
 * and resume from it in a fresh dispatcher.
 *
 * Demonstrates the full checkpoint-store lifecycle:
 *   1. Register a three-stage pipeline DAG (ingest → process → export).
 *   2. Execute with an AbortController; abort after the first stage completes.
 *   3. Capture the partial result as a Checkpoint and persist it to a
 *      MemoryCheckpointStore under a stable key.
 *   4. Construct a fresh Dagonizer + MemoryCheckpointStore (simulating a
 *      process restart, using the same in-memory store to skip I/O).
 *   5. Recall the checkpoint from the store, restore state, and resume.
 *   6. Print the persisted snapshot and the resumed state to confirm the full
 *      pipeline ran with only the remaining stages executing after resume.
 *
 * MemoryCheckpointStore is in-process only: the map is discarded when the
 * process exits. In production, swap it for a file-, Redis-, or DB-backed
 * CheckpointStore that implements save / load / delete.
 *
 * DAG definition (state, nodes, dag): examples/dags/23-checkpoint-store.ts
 *
 * Run: npx tsx examples/23-checkpoint-store.ts
 */

import {
  Checkpoint,
  CheckpointRestoreAdapterFn,
  Dagonizer,
  MemoryCheckpointStore,
} from '@noocodex/dagonizer';
import { PipelineState, dag, ExportNode, IngestNode, ProcessNode } from './dags/23-checkpoint-store.js';

const CHECKPOINT_KEY = 'pipeline:run-001';

// ── Step 1: create the dispatcher and register everything ────────────────────

class PipelineDispatcher {
  static make(): Dagonizer<PipelineState> {
    const d = new Dagonizer<PipelineState>();
    d.registerNode(new IngestNode());
    d.registerNode(new ProcessNode());
    d.registerNode(new ExportNode());
    d.registerDAG(dag);
    return d;
  }
}

process.stdout.write('\n=== 23-checkpoint-store: persist mid-run state, resume from store ===\n\n');

// ── Step 2: run the DAG, abort after the first node (ingest) completes ───────

const dispatcher1 = PipelineDispatcher.make();
const ctl          = new AbortController();
const initial      = new PipelineState();

const execution = dispatcher1.execute('pipeline', initial, { signal: ctl.signal });
let stagesCompleted = 0;
for await (const _stage of execution) {
  stagesCompleted++;
  if (stagesCompleted === 1) {
    // Abort after 'ingest' so 'process' and 'export' are still pending.
    ctl.abort(new Error('checkpoint after ingest'));
  }
}
const partial = await execution;

process.stdout.write(`[run-1] completed stages: ${JSON.stringify(partial.state.trail)}\n`);
process.stdout.write(`[run-1] cursor (next node): "${partial.cursor ?? 'null'}"\n`);
process.stdout.write(`[run-1] tally: ${String(partial.state.tally)}\n\n`);

if (partial.cursor === null) {
  throw new Error('Expected a non-null cursor after abort');
}

// ── Step 3: capture and persist the checkpoint ────────────────────────────────

// #region store-lifecycle
// #region store-init
const store1   = new MemoryCheckpointStore();
const ckpt     = await Checkpoint.capture('pipeline', partial);
await ckpt.persist(store1, CHECKPOINT_KEY);
// #endregion store-init

process.stdout.write(`[checkpoint] persisted to MemoryCheckpointStore under key "${CHECKPOINT_KEY}"\n`);
process.stdout.write(`[checkpoint] store.size=${String(store1.size)}\n`);
// Print the persisted JSON for inspection
const raw = await store1.load(CHECKPOINT_KEY);
const data = JSON.parse(raw!) as { dagName: string; cursor: string; state: unknown };
process.stdout.write(`[checkpoint] dagName="${data.dagName}" cursor="${data.cursor}"\n\n`);

// ── Step 4: fresh dispatcher + same store (simulates process restart) ─────────

const dispatcher2 = PipelineDispatcher.make();
// In production this would be a new store pointing at the same persistence
// backend; here we reuse store1 to avoid I/O.

// ── Step 5: recall, restore, resume ──────────────────────────────────────────

const recalled = await Checkpoint.recall(store1, CHECKPOINT_KEY);
if (recalled === null) {
  throw new Error(`No checkpoint found under key "${CHECKPOINT_KEY}"`);
}

const { state, dagName, cursor } = recalled.restoreState(
  CheckpointRestoreAdapterFn.fromFn((snap) => PipelineState.restore(snap)),
);

process.stdout.write(`[resume] restored cursor="${cursor}" tally=${String(state.tally)}\n`);
process.stdout.write(`[resume] trail so far: ${JSON.stringify(state.trail)}\n`);

const resumed = await dispatcher2.resume(dagName, state, cursor);
// #endregion store-lifecycle

process.stdout.write(`[resume] final tally: ${String(resumed.state.tally)}\n`);
process.stdout.write(`[resume] final trail: ${JSON.stringify(resumed.state.trail)}\n`);
process.stdout.write(`[resume] final stage: "${resumed.state.stage}"\n\n`);

// Verify: all three stages ran exactly once
if (resumed.state.tally !== 3) {
  throw new Error(`Expected tally=3, got ${String(resumed.state.tally)}`);
}
if (resumed.state.trail.join(',') !== 'ingest,process,export') {
  throw new Error(`Expected trail ingest,process,export; got ${resumed.state.trail.join(',')}`);
}

process.stdout.write('Checkpoint store lifecycle verified: abort -> persist -> recall -> resume.\n');
process.stdout.write('Lesson: MemoryCheckpointStore wires into Checkpoint.persist/recall;\n');
process.stdout.write('        cursor marks the resume point; only remaining nodes execute.\n');
