/**
 * 02-builder — DAGBuilder chainable API.
 *
 * Demonstrates the DAGBuilder as an alternative to writing DAG literals by hand.
 * The builder constructs the same JSON-LD canonical DAG that 01-linear defines
 * manually, but with compile-time exhaustiveness checking: the `routes` argument
 * to `.node()` must cover every key in the node's TOutput union.
 *
 * Watch: DAGBuilder.build() returns a fully-formed DAG including '@context',
 * '@id', and '@type'. Passing that directly to registerDAG() works without any
 * manual shape construction.
 *
 * Run: npx tsx examples/02-builder.ts
 */

import {
  DAGBuilder,
  Dagonizer,
  NodeStateBase,
} from '../src/index.js';
import type { NodeInterface } from '../src/index.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class ChatState extends NodeStateBase {
  input  = '';
  reply  = '';
  topic: 'on_topic' | 'off_topic' = 'on_topic';
}

// ---------------------------------------------------------------------------
// Nodes — identical to 01-linear; the builder wraps the same node definitions
// ---------------------------------------------------------------------------

const classify: NodeInterface<ChatState, 'on_topic' | 'off_topic'> = {
  "name": 'classify',
  "outputs": ['on_topic', 'off_topic'],
  async execute(state) {
    state.topic = state.input.toLowerCase().includes('weather') ? 'off_topic' : 'on_topic';
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
// DAG — built via DAGBuilder instead of a literal object
//
// DAGBuilder('name', 'version')
//   .node(placementName, nodeRef, routes)  ← first call auto-sets entrypoint
//   .node(placementName, nodeRef, routes)
//   .build()
//
// routes must cover every key of node's TOutput — TypeScript enforces this.
// Missing a key is a compile error; extra keys are also a compile error.
// ---------------------------------------------------------------------------

const dag = new DAGBuilder('chat', '1')
  // First .node() call → entrypoint is set to 'classify' automatically.
  .node('classify', classify, { "on_topic": 'respond', "off_topic": 'respond' })
  // routes for 'respond' must cover exactly { success } — no more, no less.
  .node('respond', respond, { "success": null })
  .build();  // materialises the canonical JSON-LD DAG document

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<ChatState>();
dispatcher.registerNode(classify);
dispatcher.registerNode(respond);
dispatcher.registerDAG(dag);  // same API as with a literal — build() returns a valid DAG

const state = new ChatState();
state.input = 'What is a generic type parameter?';
await dispatcher.execute('chat', state);

process.stdout.write('\nBuilder DAG — same shape as 01-linear, constructed via DAGBuilder (02-builder)\n');
process.stdout.write(`  input:  "${state.input}"\n`);
process.stdout.write(`  reply:  "${state.reply}"\n`);
process.stdout.write(`\n  built DAG @id: ${dag['@id']}\n`);
process.stdout.write(`  nodes:  ${dag.nodes.map(n => `${n['@type']}(${n.name})`).join(' → ')}\n`);
process.stdout.write('\nLesson: DAGBuilder.build() produces the same canonical JSON-LD shape\n');
process.stdout.write('        as a hand-written literal; routes are exhaustiveness-checked.\n');
