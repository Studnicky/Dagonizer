/**
 * 01-linear — minimal node chain.
 *
 * Demonstrates the simplest possible DAG: a two-node sequence where each node
 * routes to the next via named outputs. The `classify` node inspects state and
 * picks an output key; the placement's `outputs` map routes that key to the
 * next placement name (or null to end the flow).
 *
 * Watch: both on_topic and off_topic inputs arrive at `respond` — different
 * outputs can route to the same target placement.
 *
 * Run: npx tsx examples/01-linear.ts
 */

import {
  DAG_CONTEXT,
  Dagonizer,
  NodeStateBase,
} from '../src/index.js';
import type { DAG, NodeInterface } from '../src/index.js';

// ---------------------------------------------------------------------------
// State — the shared data bag passed through every node in this DAG
// ---------------------------------------------------------------------------

class ChatState extends NodeStateBase {
  input  = '';
  reply  = '';
  topic: 'on_topic' | 'off_topic' = 'on_topic';
}

// ---------------------------------------------------------------------------
// Nodes — registered units of work; each returns a named output
// ---------------------------------------------------------------------------

const classify: NodeInterface<ChatState, 'on_topic' | 'off_topic'> = {
  "name": 'classify',
  "outputs": ['on_topic', 'off_topic'],
  async execute(state) {
    // Pick an output key based on input content; the DAG placement
    // routes that key to the next node name.
    state.topic = state.input.toLowerCase().includes('weather')
      ? 'off_topic'
      : 'on_topic';
    return { "output": state.topic };
  },
};

const respond: NodeInterface<ChatState, 'success'> = {
  "name": 'respond',
  "outputs": ['success'],
  async execute(state) {
    state.reply = state.topic === 'on_topic'
      ? `Echo: ${state.input}`
      : `I only talk about coding, not the weather.`;
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// DAG — JSON-LD canonical form; '@type' is the RDF class discriminator
// ---------------------------------------------------------------------------

const dag: DAG = {
  '@context':   DAG_CONTEXT,                         // JSON-LD 1.1 ontology context
  '@id':        'urn:noocodex:dag:chat',             // globally unique URN for this DAG
  '@type':      'DAG',                               // RDF class: top-level DAG document
  "name":         'chat',
  "version":      '1',
  "entrypoint":   'classify',                          // first placement to execute
  "nodes": [
    {
      '@id':    'urn:noocodex:dag:chat/node/classify',
      '@type':  'SingleNode',                        // run exactly one registered node
      "name":     'classify',
      "node":     'classify',                          // refers to the registered node name
      "outputs":  { "on_topic": 'respond', "off_topic": 'respond' },  // both routes converge
    },
    {
      '@id':    'urn:noocodex:dag:chat/node/respond',
      '@type':  'SingleNode',
      "name":     'respond',
      "node":     'respond',
      "outputs":  { "success": null },                   // null = end of flow on this path
    },
  ],
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<ChatState>();
dispatcher.registerNode(classify);
dispatcher.registerNode(respond);
dispatcher.registerDAG(dag);

// On-topic: flows classify → respond, reply is an echo
const onTopic = new ChatState();
onTopic.input = 'How do I declare a const in TypeScript?';
await dispatcher.execute('chat', onTopic);

// Off-topic: same route (both outputs → respond), but different branch taken
const offTopic = new ChatState();
offTopic.input = 'What is the weather like today?';
await dispatcher.execute('chat', offTopic);

process.stdout.write('\nLinear DAG — classify → respond → END\n');
process.stdout.write(`  on_topic  → "${onTopic.reply}"\n`);
process.stdout.write(`  off_topic → "${offTopic.reply}"\n`);
process.stdout.write('\nLesson: both outputs of classify route to the same placement;\n');
process.stdout.write('        null in outputs marks the end of the flow.\n');
