/**
 * subclassing: NodeStateBase subclassing — snapshot/restore, clone, and
 * checkpoint round-trip.
 *
 * Demonstrates:
 *   1. A NodeStateBase subclass with graph-owned state fields.
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
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import { CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';

// #region full-example
class CountState extends NodeStateBase {
  count = 0;
  log: string[] = [];


}

class TickNode extends MonadicNode<CountState, 'success'> {
  readonly name    = 'tick';
  readonly '@id'   = 'urn:noocodec:node:tick';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<CountState>) {
    for (const item of batch) {
      item.state.count++;
      item.state.log.push(`tick:${item.state.count}`);
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

const tick = new TickNode();

const dag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:count',
  '@type':     'DAG',
  name:        'count',
  version:     '1',
  entrypoints: { main: 'urn:noocodec:dag:count/node/a' },
  nodes: [
    { '@id': 'urn:noocodec:dag:count/node/a', '@type': 'SingleNode', name: 'a', node: 'urn:noocodec:node:tick', outputs: { success: 'urn:noocodec:dag:count/node/b' } },
    { '@id': 'urn:noocodec:dag:count/node/b', '@type': 'SingleNode', name: 'b', node: 'urn:noocodec:node:tick', outputs: { success: 'urn:noocodec:dag:count/node/c' } },
    { '@id': 'urn:noocodec:dag:count/node/c', '@type': 'SingleNode', name: 'c', node: 'urn:noocodec:node:tick', outputs: { success: 'urn:noocodec:dag:count/node/end' } },
    { '@id': 'urn:noocodec:dag:count/node/end', '@type': 'TerminalNode', name: 'end', outcome: 'completed' },
  ],
};

const dispatcher = new Dagonizer<CountState>();
dispatcher.registerNode(tick);
dispatcher.registerDAG(dag);

// Run, abort after one node, checkpoint, restore, resume.
const ctl = new AbortController();
const execution = dispatcher.execute('urn:noocodec:dag:count', new CountState(), { signal: ctl.signal });
let stages = 0;
for await (const _stage of execution) {
  stages++;
  if (stages === 1) ctl.abort(new Error('pause after a'));
}
const partial = await execution;

if (partial.cursor === null) {
  process.stdout.write('\nsubclassing: run completed before abort; no cursor to checkpoint\n');
} else {
  process.stdout.write('\nsubclassing: CountState with graph-owned fields\n');
  process.stdout.write(`  after abort:  count=${partial.state.count} cursor="${partial.cursor}"\n`);

  const ckpt  = await Checkpoint.capture('urn:noocodec:dag:count', partial);
  const ckpt2 = Checkpoint.load(JSON.parse(ckpt.toJson()));

  const { state: s2, dagName, cursor } = await ckpt2.restoreState(
    CheckpointRestoreAdapter.wrap(() => new CountState()),
  );

  const final = await dispatcher.resume(dagName, s2, cursor);
  process.stdout.write(`  after resume: count=${final.state.count} log=${JSON.stringify(final.state.log)}\n`);
  // → count=3, log=["tick:1","tick:2","tick:3"]
}
// #endregion full-example
