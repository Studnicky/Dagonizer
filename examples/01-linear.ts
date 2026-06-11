/**
 * 01-linear: minimal node chain.
 *
 * Demonstrates the simplest possible DAG: a two-node sequence where each node
 * routes to the next via named outputs. The `classify` node inspects state and
 * picks an output key; the placement's `outputs` map routes that key to the
 * next placement name, or to a canonical TerminalNode to end the flow.
 *
 * Watch: both on_topic and off_topic inputs arrive at `respond`; different
 * outputs can route to the same target placement.
 *
 * DAG definition (state, nodes, dag): examples/dags/01-linear.ts
 *
 * Run: npx tsx examples/01-linear.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import { ChatState, ClassifyNode, RespondNode, dag } from './dags/01-linear.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<ChatState>();
dispatcher.registerNode(new ClassifyNode());
dispatcher.registerNode(new RespondNode());
dispatcher.registerDAG(dag);

// On-topic: flows classify → respond, reply is an echo
const onTopic = new ChatState();
onTopic.input = 'How do I declare a const in TypeScript?';
await dispatcher.execute('chat', onTopic);

// Off-topic: same route (both outputs → respond), but different branch taken
const offTopic = new ChatState();
offTopic.input = 'What is the weather like today?';
await dispatcher.execute('chat', offTopic);

process.stdout.write('\nLinear DAG: classify -> respond -> END\n');
process.stdout.write(`  on_topic  → "${onTopic.reply}"\n`);
process.stdout.write(`  off_topic → "${offTopic.reply}"\n`);
process.stdout.write('\nLesson: both outputs of classify route to the same placement;\n');
process.stdout.write('        a TerminalNode marks the explicit end of the flow.\n');
// #endregion run
