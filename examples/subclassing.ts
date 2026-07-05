/**
 * subclassing: NodeStateBase subclassing — snapshot/restore, clone, and
 * checkpoint round-trip.
 *
 * Demonstrates:
 *   1. A NodeStateBase subclass with snapshotData / restoreData overrides.
 *   2. A simple TickNode that mutates CountState.
 *   3. A checkpoint/resume round-trip: abort after one node, capture, restore.
 *
 * DAG definition (state variants, ApiNode): examples/dags/subclassing.ts
 *
 * Run: npx tsx examples/subclassing.ts
 */

import {
  Checkpoint,
  Batch,
  DAG_CONTEXT,
  Dagonizer,
  MonadicNode,
  NodeOutputBuilder,
  NodeStateBase,
  RoutedBatchBuilder,
} from '@studnicky/dagonizer';
import { CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

// #region full-example
class CountState extends NodeStateBase {
  count = 0;
  log: string[] = [];

  protected override snapshotData(): JsonObjectType {
    return { count: this.count, log: [...this.log] };
  }

  protected override restoreData(snap: JsonObjectType): void {
    const c = snap['count'];
    if (typeof c === 'number') this.count = c;
    const l = snap['log'];
    if (Array.isArray(l)) this.log = l.filter((x): x is string => typeof x === 'string');
  }
}

class TickNode extends MonadicNode<CountState, 'success'> {
  readonly name    = 'tick';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<CountState>) {
    for (const item of batch) {
      item.state.count++;
      item.state.log.push(`tick:${item.state.count}`);
    }
    return RoutedBatchBuilder.of(NodeOutputBuilder.of('success').output, batch);
  }
}

const tick = new TickNode();

const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:count',
  '@type':     'DAG',
  name:        'count',
  version:     '1',
  entrypoint:  'a',
  nodes: [
    { '@id': 'urn:noocodex:dag:count/node/a', '@type': 'SingleNode', name: 'a', node: 'tick', outputs: { success: 'b' } },
    { '@id': 'urn:noocodex:dag:count/node/b', '@type': 'SingleNode', name: 'b', node: 'tick', outputs: { success: 'c' } },
    { '@id': 'urn:noocodex:dag:count/node/c', '@type': 'SingleNode', name: 'c', node: 'tick', outputs: { success: 'end' } },
    { '@id': 'urn:noocodex:dag:count/node/end', '@type': 'TerminalNode', name: 'end', outcome: 'completed' },
  ],
};

const dispatcher = new Dagonizer<CountState>();
dispatcher.registerNode(tick);
dispatcher.registerDAG(dag);

// Run, abort after one node, checkpoint, restore, resume.
const ctl = new AbortController();
const execution = dispatcher.execute('count', new CountState(), { signal: ctl.signal });
let stages = 0;
for await (const _stage of execution) {
  stages++;
  if (stages === 1) ctl.abort(new Error('pause after a'));
}
const partial = await execution;

if (partial.cursor === null) {
  process.stdout.write('\nsubclassing: run completed before abort; no cursor to checkpoint\n');
} else {
  process.stdout.write('\nsubclassing: CountState with snapshotData/restoreData\n');
  process.stdout.write(`  after abort:  count=${partial.state.count} cursor="${partial.cursor}"\n`);

  const ckpt  = await Checkpoint.capture('count', partial);
  const ckpt2 = Checkpoint.load(JSON.parse(ckpt.toJson()));

  const { state: s2, dagName, cursor } = ckpt2.restoreState(
    CheckpointRestoreAdapter.wrap((snap) => CountState.restore(snap)),
  );

  const final = await dispatcher.resume(dagName, s2, cursor);
  process.stdout.write(`  after resume: count=${final.state.count} log=${JSON.stringify(final.state.log)}\n`);
  // → count=3, log=["tick:1","tick:2","tick:3"]
}
// #endregion full-example
