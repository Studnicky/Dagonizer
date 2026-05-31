/**
 * 02-builder.topology/dags: pure topology for the DAGBuilder example.
 *
 * No side effects, no top-level await. Exports ChatState, classify, respond,
 * and dag for use by the runnable script (examples/02-builder.ts) and the
 * documentation carve directives.
 *
 * Runnable script: examples/02-builder.ts
 */

// #region imports
import {
  DAGBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';
// #endregion imports

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class ChatState extends NodeStateBase {
  input  = '';
  reply  = '';
  topic: 'on_topic' | 'off_topic' = 'on_topic';
}

// ---------------------------------------------------------------------------
// Nodes: identical to 01-linear; the builder wraps the same node definitions
// ---------------------------------------------------------------------------

// #region nodes
export const classify: NodeInterface<ChatState, 'on_topic' | 'off_topic'> = {
  "name": 'classify',
  "outputs": ['on_topic', 'off_topic'],
  async execute(state) {
    state.topic = state.input.toLowerCase().includes('weather') ? 'off_topic' : 'on_topic';
    return { "output": state.topic };
  },
};

export const respond: NodeInterface<ChatState, 'success'> = {
  "name": 'respond',
  "outputs": ['success'],
  async execute(state) {
    state.reply = state.topic === 'on_topic'
      ? `Echo: ${state.input}`
      : `I only talk about coding, not the weather.`;
    return { "output": 'success' };
  },
};
// #endregion nodes

// ---------------------------------------------------------------------------
// DAG: built via DAGBuilder instead of a literal object
//
// DAGBuilder('name', 'version')
//   .node(placementName, nodeRef, routes)  ← first call auto-sets entrypoint
//   .node(placementName, nodeRef, routes)
//   .build()
//
// routes must cover every key of node's TOutput; TypeScript enforces this.
// Missing a key is a compile error; extra keys are also a compile error.
// ---------------------------------------------------------------------------

// #region builder
export const dag = new DAGBuilder('chat', '1')
  // First .node() call → entrypoint is set to 'classify' automatically.
  .node('classify', classify, { "on_topic": 'respond', "off_topic": 'respond' })
  // routes for 'respond' must cover exactly { success }, no more, no less.
  .node('respond', respond, { "success": 'end' })
  .terminal('end')
  .build();  // materialises the canonical JSON-LD DAG document
// #endregion builder
