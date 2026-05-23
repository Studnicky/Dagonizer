/**
 * 10-shared-state — MemoryStore on the services bag, with checkpoint round-trip.
 *
 * Demonstrates:
 *   1. A MemoryStore threaded through the services bag.
 *   2. Two nodes and a sub-DAG that accumulate entries to the same store.
 *   3. Checkpoint.capture() snapshots the store alongside parent state.
 *   4. Checkpoint.load() + restoreStores() recovers the store on resume.
 *
 * Run: npx tsx examples/10-shared-state.ts
 */

import {
  Checkpoint,
  DAGBuilder,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';
import { MemoryStore } from '@noocodex/dagonizer/store';
import type { Store } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// Services bag type
// ---------------------------------------------------------------------------

interface Services {
  log: Store;
}

// ---------------------------------------------------------------------------
// Nodes — each appends its own name to the store's 'entries' key
// ---------------------------------------------------------------------------

function makeStep(stepName: string): NodeInterface<NodeStateBase, 'done', Services> {
  return {
    "name":    stepName,
    "outputs": ['done'],
    async execute(_state, context) {
      await context.services.log.update<string>('entries', (current) => {
        const existing = current?.split(',').filter(Boolean) ?? [];
        return [...existing, stepName].join(',');
      });
      return { "output": 'done' };
    },
  };
}

const stepA     = makeStep('step-a');
const stepB     = makeStep('step-b');
const childStep = makeStep('child-step');

// ---------------------------------------------------------------------------
// DAGs — child DAG placed inside the parent
// ---------------------------------------------------------------------------

const childDag = new DAGBuilder('sub-flow', '1')
  .node('child-step', childStep, { "done": null })
  .build();

const parentDag = new DAGBuilder('main-flow', '1')
  .node('step-a', stepA, { "done": 'run-child' })
  .deepDAG('run-child', 'sub-flow', { "success": 'step-b', "error": 'step-b' })
  .node('step-b', stepB, { "done": null })
  .build();

// ---------------------------------------------------------------------------
// Part 1 — Normal run (all three steps accumulate to the store)
// ---------------------------------------------------------------------------

{
  const logStore = new MemoryStore();
  const dispatcher = new Dagonizer<NodeStateBase, Services>({ "services": { "log": logStore } });

  dispatcher.registerNode(stepA);
  dispatcher.registerNode(stepB);
  dispatcher.registerNode(childStep);
  dispatcher.registerDAG(childDag);
  dispatcher.registerDAG(parentDag);

  await dispatcher.execute('main-flow', new NodeStateBase());

  const entries = await logStore.get('entries') ?? '';
  process.stdout.write('\nPart 1 — Normal run:\n');
  process.stdout.write(`  log.entries = "${entries}"\n`);
  // → "step-a,child-step,step-b"
}

// ---------------------------------------------------------------------------
// Part 2 — Checkpoint round-trip
//   Abort after step-a, capture checkpoint with store, restore, resume.
// ---------------------------------------------------------------------------

{
  const logStore = new MemoryStore();
  const dispatcher = new Dagonizer<NodeStateBase, Services>({ "services": { "log": logStore } });

  dispatcher.registerNode(stepA);
  dispatcher.registerNode(stepB);
  dispatcher.registerNode(childStep);
  dispatcher.registerDAG(childDag);
  dispatcher.registerDAG(parentDag);

  // Abort mid-run: abort after step-a to produce a checkpoint-worthy cursor.
  const ctl = new AbortController();
  const execution = dispatcher.execute('main-flow', new NodeStateBase(), { "signal": ctl.signal });
  let seen = 0;
  for await (const _event of execution) {
    seen++;
    if (seen === 1) ctl.abort(new Error('checkpoint'));
  }
  const partial = await execution;

  if (partial.cursor === null) {
    process.stdout.write('\nPart 2 — run completed before abort; no cursor\n');
  } else {
    // Capture checkpoint — snapshot the store alongside the parent state.
    const ckpt = await Checkpoint.capture('main-flow', partial, { "stores": { "log": logStore } });
    const json = ckpt.toJson();

    process.stdout.write('\nPart 2 — Checkpoint captured:\n');
    process.stdout.write(`  cursor                  = "${partial.cursor}"\n`);
    process.stdout.write(`  log at capture          = "${await logStore.get('entries') ?? ''}"\n`);

    // Resume — restore store from checkpoint, then resume execution.
    const freshLog = new MemoryStore();
    const ckpt2    = Checkpoint.load(JSON.parse(json) as unknown);
    await ckpt2.restoreStores({ "log": freshLog });

    const restoredEntries = await freshLog.get('entries') ?? '';
    process.stdout.write(`  log after restoreStores = "${restoredEntries}"\n`);

    const resumeDispatcher = new Dagonizer<NodeStateBase, Services>({ "services": { "log": freshLog } });
    resumeDispatcher.registerNode(stepA);
    resumeDispatcher.registerNode(stepB);
    resumeDispatcher.registerNode(childStep);
    resumeDispatcher.registerDAG(childDag);
    resumeDispatcher.registerDAG(parentDag);

    const { dagName, state, cursor } = ckpt2.restoreState(
      (snap) => NodeStateBase.restore(snap),
    );
    await resumeDispatcher.resume(dagName, state, cursor);

    const finalEntries = await freshLog.get('entries') ?? '';
    process.stdout.write(`  log after resume        = "${finalEntries}"\n`);
    // → "step-a,child-step,step-b"  (all three present, none duplicated)
  }
}
