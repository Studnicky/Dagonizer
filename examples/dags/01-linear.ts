/**
 * 01-linear/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/01-linear.ts (the executable entry point).
 */

// #region imports
import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
// #endregion imports

// #region state
export class ChatState extends NodeStateBase {
  input  = '';
  reply  = '';
  topic: 'on_topic' | 'off_topic' = 'on_topic';
}
// #endregion state

// #region node
export class ClassifyNode extends ScalarNode<ChatState, 'on_topic' | 'off_topic'> {
  readonly name = 'classify';
  readonly outputs = ['on_topic', 'off_topic'] as const;
  override get outputSchema(): Record<'on_topic' | 'off_topic', SchemaObjectType> {
    return { 'on_topic': { 'type': 'object' }, 'off_topic': { 'type': 'object' } };
  }

  protected override async executeOne(state: ChatState) {
    // Pick an output key based on input content; the DAG placement
    // routes that key to the next node name.
    state.topic = state.input.toLowerCase().includes('weather')
      ? 'off_topic'
      : 'on_topic';
    return NodeOutputBuilder.of(state.topic);
  }
}

export class RespondNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'respond';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  protected override async executeOne(state: ChatState) {
    state.reply = state.topic === 'on_topic'
      ? `Echo: ${state.input}`
      : `I only talk about coding, not the weather.`;
    return NodeOutputBuilder.of('success');
  }
}
// #endregion node

// #region dag
export const dag: DAGType = {
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
      "outputs":  { "success": 'end' },               // routes to canonical terminal
    },
    {
      '@id':    'urn:noocodex:dag:chat/node/end',
      '@type':  'TerminalNode',
      "name":     'end',
      "outcome":  'completed',
    },
  ],
};
// #endregion dag
