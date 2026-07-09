/**
 * 01-linear: minimal node chain.
 *
 * Demonstrates the simplest possible DAG: a two-node sequence where each node
 * routes to the next via named outputs. The `classify` node inspects state and
 * picks an output key; the placement's `outputs` map routes that key to the
 * next placement IRI, or to a canonical TerminalNode to end the flow.
 *
 * Watch: both on_topic and off_topic inputs arrive at `respond`; different
 * outputs can route to the same target placement.
 *
 * DAG definition (state, nodes, dag): examples/dags/01-linear.ts
 *
 * Run: npx tsx examples/01-linear.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
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
await dispatcher.execute('urn:noocodec:dag:chat', onTopic);

// Off-topic: same route (both outputs → respond), but different branch taken
const offTopic = new ChatState();
offTopic.input = 'What is the weather like today?';
await dispatcher.execute('urn:noocodec:dag:chat', offTopic);

process.stdout.write('\nLinear DAG: classify -> respond -> END\n');
process.stdout.write(`  on_topic  → "${onTopic.reply}"\n`);
process.stdout.write(`  off_topic → "${offTopic.reply}"\n`);
process.stdout.write('\nLesson: both outputs of classify route to the same placement;\n');
process.stdout.write('        a TerminalNode marks the explicit end of the flow.\n');
// #endregion run

// #region registry-read
// Read accessors: getDAG, getNode, listDAGs, listNodes.
// getDAG/getNode use exact registry keys; list accessors return fresh shallow copies.
const registeredDag  = dispatcher.getDAG('urn:noocodec:dag:chat'); // DAG | undefined
const registeredNode = dispatcher.getNode('classify');  // NodeInterface<...> | undefined
const allDags        = dispatcher.listDAGs();            // readonly DAG[]
const allNodes       = dispatcher.listNodes();           // readonly NodeInterface<...>[]
void registeredDag; void registeredNode; void allDags; void allNodes;
// #endregion registry-read

// ---------------------------------------------------------------------------
// execute() return modes: awaitable and async-iterable (doc regions)
// ---------------------------------------------------------------------------

// #region execute-await
// Awaitable form: await the execution for the final ExecutionResultType.
//   result.state         the final state (same reference as input)
//   result.cursor        null if completed; a node name if interrupted
//   result.executedNodes ordered array of nodes that ran
//   result.skippedNodes  nodes that were skipped (e.g. empty scatter source)
const awaitDispatcher = new Dagonizer<ChatState>();
awaitDispatcher.registerNode(new ClassifyNode());
awaitDispatcher.registerNode(new RespondNode());
awaitDispatcher.registerDAG(dag);

const awaitState = new ChatState();
awaitState.input = 'How do I await a Promise in TypeScript?';
const result = await awaitDispatcher.execute('urn:noocodec:dag:chat', awaitState);
void result; // result.state, result.cursor, result.executedNodes, result.skippedNodes
// #endregion execute-await

// #region execute-iterable
// Async-iterable form: one NodeResult event per node as the flow runs.
// The flow body runs once; both modes share the same internal generator.
const iterDispatcher = new Dagonizer<ChatState>();
iterDispatcher.registerNode(new ClassifyNode());
iterDispatcher.registerNode(new RespondNode());
iterDispatcher.registerDAG(dag);

const iterState = new ChatState();
iterState.input = 'Explain generics in TypeScript';
const execution = iterDispatcher.execute('urn:noocodec:dag:chat', iterState);
for await (const nodeResult of execution) {
  process.stdout.write(`  node=${nodeResult.nodeName} output=${String(nodeResult.output)}\n`);
}
const iterResult = await execution; // cached — generator ran once; returns same result
void iterResult;
// #endregion execute-iterable
