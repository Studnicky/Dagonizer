/**
 * 34-stream-channel: bridge a PUSH producer into a scatter via StreamChannel.driven.
 *
 * Demonstrates:
 *   - StreamChannel.driven(producer, options?) — bounded push-to-pull bridge
 *   - Back-pressure: push awaits when channel buffer is full
 *   - AsyncIterable<T> as scatter source
 *
 * DAG definitions: examples/dags/34-stream-channel.ts
 *
 * Run: npx tsx examples/34-stream-channel.ts
 */

import { Dagonizer, StreamChannel } from '@studnicky/dagonizer';
import {
  ChannelState,
  dag,
  NumberProducer,
  ProcessNode,
} from './dags/34-stream-channel.js';

const dispatcher = new Dagonizer<ChannelState>();
dispatcher.registerNode(new ProcessNode());
dispatcher.registerDAG(dag);

const state   = new ChannelState();
state.source  = StreamChannel.driven(NumberProducer.of(10), { capacity: 4 });

const result = await dispatcher.execute('urn:noocodec:dag:stream-channel', state);

process.stdout.write(`Results: ${JSON.stringify([...state.results].sort((a, b) => a - b))}\n`);
process.stdout.write(`Terminal outcome: ${result.terminalOutcome}\n`);
process.stdout.write(`Count: ${state.results.length}\n`);

if (result.terminalOutcome !== 'completed') {
  throw new Error(`Expected terminalOutcome 'completed', got '${result.terminalOutcome}'`);
}
if (state.results.length !== 10) {
  throw new Error(`Expected 10 results, got ${state.results.length}`);
}

const sorted   = [...state.results].sort((a, b) => a - b);
const expected = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
for (let i = 0; i < expected.length; i++) {
  if (sorted[i] !== expected[i]) {
    throw new Error(`Expected sorted[${i}] = ${expected[i]}, got ${sorted[i]}`);
  }
}

process.stdout.write('All assertions passed.\n');
