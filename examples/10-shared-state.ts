/**
 * 10-shared-state: MemoryStore constructor-injected into nodes, with checkpoint round-trip.
 *
 * Demonstrates:
 *   1. A MemoryStore injected into each node via its constructor.
 *   2. Two nodes and an embedded sub-DAG that accumulate entries to the
 *      same store.
 *   3. Checkpoint.capture() snapshots the store alongside parent state.
 *   4. Checkpoint.load() + restoreStores() recovers the store on resume.
 *
 * DAG definition (nodes and DAG consts): examples/dags/10-shared-state.ts
 *
 * Run: npx tsx examples/10-shared-state.ts
 */

import {
  Checkpoint,
  Dagonizer,
  NodeStateBase,
} from '@studnicky/dagonizer';
import { CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import {
  MemoryStore,
  StepANode,
  StepBNode,
  ChildStepNode,
  childDag,
  parentDag,
} from './dags/10-shared-state.js';

// Part 1: Normal run (all three steps accumulate to the store)
// #region run
{
  // #region store-init
  const logStore = new MemoryStore();
  const dispatcher = new Dagonizer<NodeStateBase>();
  // #endregion store-init

  dispatcher.registerNode(new StepANode(logStore));
  dispatcher.registerNode(new StepBNode(logStore));
  dispatcher.registerNode(new ChildStepNode(logStore));
  dispatcher.registerDAG(childDag);
  dispatcher.registerDAG(parentDag);

  await dispatcher.execute('urn:noocodec:dag:main-flow', new NodeStateBase());

  const entries = await logStore.get('entries') ?? '';
  process.stdout.write('\nPart 1: Normal run:\n');
  process.stdout.write(`  log.entries = "${entries}"\n`);
  // → "step-a,child-step,step-b"
}

// Part 2: Checkpoint round-trip
//   Abort after step-a, capture checkpoint with store, restore, resume.

// #region store-checkpoint
{
  const logStore = new MemoryStore();
  const dispatcher = new Dagonizer<NodeStateBase>();

  dispatcher.registerNode(new StepANode(logStore));
  dispatcher.registerNode(new StepBNode(logStore));
  dispatcher.registerNode(new ChildStepNode(logStore));
  dispatcher.registerDAG(childDag);
  dispatcher.registerDAG(parentDag);

  // Abort mid-run: abort after step-a to produce a checkpoint-worthy cursor.
  const ctl = new AbortController();
  const execution = dispatcher.execute('urn:noocodec:dag:main-flow', new NodeStateBase(), { "signal": ctl.signal });
  let seen = 0;
  for await (const _event of execution) {
    seen++;
    if (seen === 1) ctl.abort(new Error('checkpoint'));
  }
  const partial = await execution;

  if (partial.cursor === null) {
    process.stdout.write('\nPart 2: run completed before abort; no cursor\n');
  } else {
    // Capture checkpoint: snapshot the store alongside the parent state.
    const ckpt = await Checkpoint.capture('urn:noocodec:dag:main-flow', partial, { "stores": { "log": logStore } });
    const json = ckpt.toJson();

    process.stdout.write('\nPart 2: Checkpoint captured:\n');
    process.stdout.write(`  cursor                  = "${partial.cursor}"\n`);
    process.stdout.write(`  log at capture          = "${await logStore.get('entries') ?? ''}"\n`);

    // Resume: restore store from checkpoint, then resume execution.
    const freshLog = new MemoryStore();
    const ckpt2    = Checkpoint.load(JSON.parse(json));
    await ckpt2.restoreStores({ "log": freshLog });

    const restoredEntries = await freshLog.get('entries') ?? '';
    process.stdout.write(`  log after restoreStores = "${restoredEntries}"\n`);

    const resumeDispatcher = new Dagonizer<NodeStateBase>();
    resumeDispatcher.registerNode(new StepANode(freshLog));
    resumeDispatcher.registerNode(new StepBNode(freshLog));
    resumeDispatcher.registerNode(new ChildStepNode(freshLog));
    resumeDispatcher.registerDAG(childDag);
    resumeDispatcher.registerDAG(parentDag);

    const { dagName, state, cursor } = ckpt2.restoreState(
      CheckpointRestoreAdapter.wrap((snap) => NodeStateBase.restore(snap)),
    );
    await resumeDispatcher.resume(dagName, state, cursor);

    const finalEntries = await freshLog.get('entries') ?? '';
    process.stdout.write(`  log after resume        = "${finalEntries}"\n`);
    // → "step-a,child-step,step-b"  (all three present, none duplicated)
  }
}
// #endregion store-checkpoint
// #endregion run
