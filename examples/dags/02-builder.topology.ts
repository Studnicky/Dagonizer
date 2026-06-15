/**
 * 02-builder.topology/dags: pure topology for the DAGBuilder example.
 *
 * No side effects, no top-level await. Exports ChatState, ClassifyNode,
 * RespondNode, and dag for use by the runnable script (examples/02-builder.ts)
 * and the documentation carve directives.
 *
 * Runnable script: examples/02-builder.ts
 */

// #region imports
import {
  DAGBuilder,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@noocodex/dagonizer';
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
export class ClassifyNode extends ScalarNode<ChatState, 'on_topic' | 'off_topic'> {
  readonly name = 'classify';
  readonly outputs = ['on_topic', 'off_topic'] as const;

  protected override async executeOne(state: ChatState) {
    state.topic = state.input.toLowerCase().includes('weather') ? 'off_topic' : 'on_topic';
    return NodeOutputBuilder.of(state.topic);
  }
}

export class RespondNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'respond';
  readonly outputs = ['success'] as const;

  protected override async executeOne(state: ChatState) {
    state.reply = state.topic === 'on_topic'
      ? `Echo: ${state.input}`
      : `I only talk about coding, not the weather.`;
    return NodeOutputBuilder.of('success');
  }
}
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
  .node('classify', new ClassifyNode(), { "on_topic": 'respond', "off_topic": 'respond' })
  // routes for 'respond' must cover exactly { success }, no more, no less.
  .node('respond', new RespondNode(), { "success": 'end' })
  .terminal('end')
  .build();  // materialises the canonical JSON-LD DAG document
// #endregion builder
