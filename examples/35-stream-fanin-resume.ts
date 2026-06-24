/**
 * 35-stream-fanin-resume: merge two producers via fanIn; genuine abort-and-resume
 * via StreamChannel.resumable + StreamCursor.
 *
 * Demonstrates:
 *   - StreamChannel.fanIn(producers) — concurrent multi-producer merge
 *   - ResumableStreamProducerInterface — produce(sink, resumeAfter) skips already-consumed items
 *   - StreamCursor.resumeAfter(state, scatterName) — reads durable pull count from a real interruption
 *   - Genuine abort-then-resume: first run aborted partway, cursor read from real checkpoint,
 *     StreamChannel.resumable supplies only the remainder, exactly-once coverage verified
 *
 * DAG definitions: examples/dags/35-stream-fanin-resume.ts
 *
 * Run: npx tsx examples/35-stream-fanin-resume.ts
 */

import { Dagonizer, StreamChannel, StreamCursor } from '@studnicky/dagonizer';
import { SCATTER_PROGRESS_KEY } from '@studnicky/dagonizer';
import {
  AbortCoordinator,
  AbortingCollectNode,
  CollectNode,
  DeterministicProducer,
  FanInState,
  fanInDag,
  RangeProducer,
  resumeDag,
} from './dags/35-stream-fanin-resume.js';

// ---------------------------------------------------------------------------
// Part 1: fanIn — merge two range producers
// ---------------------------------------------------------------------------

process.stdout.write('\n=== Part 1: StreamChannel.fanIn ===\n\n');

const dispatcher1 = new Dagonizer<FanInState>();
dispatcher1.registerNode(new CollectNode());
dispatcher1.registerDAG(fanInDag);

const fanInState  = new FanInState();
fanInState.source = StreamChannel.fanIn([
  RangeProducer.range(0, 5),
  RangeProducer.range(10, 15),
]);

const fanInResult = await dispatcher1.execute('stream-fanin', fanInState);

const fanInSorted = [...fanInState.results].sort((a, b) => a - b);
process.stdout.write(`fanIn results (sorted): ${JSON.stringify(fanInSorted)}\n`);
process.stdout.write(`fanIn count: ${fanInState.results.length}\n`);
process.stdout.write(`fanIn outcome: ${fanInResult.terminalOutcome}\n`);

if (fanInResult.terminalOutcome !== 'completed') {
  throw new Error(`Expected 'completed', got '${fanInResult.terminalOutcome}'`);
}
if (fanInState.results.length !== 10) {
  throw new Error(`Expected 10 results, got ${fanInState.results.length}`);
}

const fanInExpected = [0, 1, 2, 3, 4, 10, 11, 12, 13, 14];
for (let i = 0; i < fanInExpected.length; i++) {
  if (fanInSorted[i] !== fanInExpected[i]) {
    throw new Error(`fanIn sorted[${i}]: expected ${fanInExpected[i]}, got ${fanInSorted[i]}`);
  }
}

process.stdout.write('fanIn assertions passed.\n');

// ---------------------------------------------------------------------------
// Part 2: genuine abort → cursor → StreamChannel.resumable → exactly-once
//
// DeterministicProducer.of(TOTAL) generates items 0..TOTAL-1.
// AbortCoordinator fires the run-level abort after ABORT_AFTER scatter worker
// completions. The first run is interrupted, the real checkpoint cursor is read
// via StreamCursor.resumeAfter, and the resume supplies only the remainder via
// StreamChannel.resumable(producer, cursor). The engine replays inbox items
// (in-flight at abort time) from the checkpoint; the channel supplies only
// fresh items at index >= cursor. The union covers every item exactly once.
// ---------------------------------------------------------------------------

process.stdout.write('\n=== Part 2: genuine abort → StreamCursor → StreamChannel.resumable ===\n\n');

const TOTAL = 20;
const ABORT_AFTER = 6;

const controller = new AbortController();
const coordinator = AbortCoordinator.of(controller, ABORT_AFTER);

const dispatcher2 = new Dagonizer<FanInState>();
dispatcher2.registerNode(new AbortingCollectNode(coordinator));
dispatcher2.registerDAG(resumeDag);

const firstState = new FanInState();
// capacity:1 ensures genuine backpressure so the producer cannot pre-fill
// the buffer and the abort can propagate before all items are consumed.
firstState.source = StreamChannel.resumable(
  DeterministicProducer.of(TOTAL),
  0,
  { 'capacity': 1, 'signal': controller.signal },
);

const partial = await dispatcher2.execute('resume-stream', firstState, { 'signal': controller.signal });

process.stdout.write(`First run cursor: ${String(partial.cursor)} (expected 'resume-stream' — interrupted)\n`);
process.stdout.write(`First run results gathered so far: ${partial.state.results.length} items\n`);
process.stdout.write(`First run results (sorted): ${JSON.stringify([...partial.state.results].sort((a, b) => a - b))}\n`);

if (partial.cursor !== 'resume-stream') {
  throw new Error(`Expected cursor 'resume-stream' after abort, got '${partial.cursor}'`);
}

// Read the real pull count from the interrupted checkpoint (not a hardcoded value).
const cursor = StreamCursor.resumeAfter(partial.state, 'resume-stream');
process.stdout.write(`StreamCursor.resumeAfter: ${cursor} (must be > 0 — real pull count from checkpoint)\n`);

if (cursor === 0) {
  throw new Error('StreamCursor.resumeAfter returned 0 — checkpoint was not preserved after abort');
}

// Resume: fresh dispatcher; source supplies only the remainder starting at cursor.
// The engine replays inbox items (in-flight at abort) from the checkpoint;
// the channel supplies only fresh items at index >= cursor.
const resumeDispatcher = new Dagonizer<FanInState>();
resumeDispatcher.registerNode(new CollectNode());
resumeDispatcher.registerDAG(resumeDag);

const resumeState = new FanInState();
// Carry over checkpoint metadata so the engine locates the scatter's resume state.
const checkpoint = partial.state.getMetadata(SCATTER_PROGRESS_KEY);
if (checkpoint !== undefined) {
  resumeState.setMetadata(SCATTER_PROGRESS_KEY, checkpoint);
}
// Carry over already-gathered results (append gather folds results across both runs).
resumeState.results = [...partial.state.results];
// Supply the remainder via StreamChannel.resumable — producer skips [0, cursor).
resumeState.source = StreamChannel.resumable(
  DeterministicProducer.of(TOTAL),
  cursor,
);

const resumeResult = await resumeDispatcher.resume('resume-stream', resumeState, 'resume-stream');

process.stdout.write(`Resume cursor: ${String(resumeResult.cursor)} (expected null — completed)\n`);
process.stdout.write(`Final results count: ${resumeResult.state.results.length}\n`);
process.stdout.write(`Final results (sorted): ${JSON.stringify([...resumeResult.state.results].sort((a, b) => a - b))}\n`);

if (resumeResult.cursor !== null) {
  throw new Error(`Expected null cursor after resume, got '${resumeResult.cursor}'`);
}

// Final results array contains exactly TOTAL items.
if (resumeResult.state.results.length !== TOTAL) {
  throw new Error(`Expected ${TOTAL} gathered results; got ${resumeResult.state.results.length}`);
}

// No duplicates in the final set.
const finalSet = new Set(resumeResult.state.results);
if (finalSet.size !== TOTAL) {
  const dupes = resumeResult.state.results.filter(
    (v, i, arr) => arr.indexOf(v) !== i,
  );
  throw new Error(`Duplicates found in final results: [${dupes.join(', ')}]`);
}

// All items 0..TOTAL-1 are present.
for (let i = 0; i < TOTAL; i++) {
  if (!finalSet.has(i)) {
    throw new Error(`Item ${i} is missing from the final results`);
  }
}

process.stdout.write(`Total unique items: ${finalSet.size} / ${TOTAL}\n`);
process.stdout.write('Exactly-once assertions passed.\n');
