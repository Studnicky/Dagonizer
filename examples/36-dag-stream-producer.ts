/**
 * 36-dag-stream-producer: bridge an inner DAG's result stream into an outer scatter.
 *
 * Demonstrates:
 *   - DagStreamProducer<T> subclassing: executions() + select()
 *   - Inner DAG results feed outer scatter as back-pressured items
 *   - StreamChannel.driven bridges DagStreamProducer into scatter source
 *
 * DAG definitions: examples/dags/36-dag-stream-producer.ts
 *
 * Run: npx tsx examples/36-dag-stream-producer.ts
 */

import { Dagonizer, StreamChannel } from '@studnicky/dagonizer';
import {
  LabelStreamProducer,
  OuterState,
  outerDag,
  RecordNode,
} from './dags/36-dag-stream-producer.js';

const outerDispatcher = new Dagonizer<OuterState>();
outerDispatcher.registerNode(new RecordNode());
outerDispatcher.registerDAG(outerDag);

const state   = new OuterState();
state.source  = StreamChannel.driven(LabelStreamProducer.of([0, 1, 2, 3, 4]));

const result = await outerDispatcher.execute('urn:noocodec:dag:label-stream', state);

const sorted = [...state.labels].sort();
process.stdout.write(`Labels (sorted): ${JSON.stringify(sorted)}\n`);
process.stdout.write(`Count: ${state.labels.length}\n`);
process.stdout.write(`Outcome: ${result.terminalOutcome}\n`);

if (result.terminalOutcome !== 'completed') {
  throw new Error(`Expected 'completed', got '${result.terminalOutcome}'`);
}
if (state.labels.length !== 5) {
  throw new Error(`Expected 5 labels, got ${state.labels.length}`);
}

const expected = ['item-0', 'item-1', 'item-2', 'item-3', 'item-4'];
for (let i = 0; i < expected.length; i++) {
  if (sorted[i] !== expected[i]) {
    throw new Error(`sorted[${i}]: expected '${expected[i]}', got '${sorted[i]}'`);
  }
}

process.stdout.write('All assertions passed.\n');
