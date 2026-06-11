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
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface} from '@noocodex/dagonizer';
// #endregion imports

// #region state
export class ChatState extends NodeStateBase {
  input  = '';
  reply  = '';
  topic: 'on_topic' | 'off_topic' = 'on_topic';
}
// #endregion state

// #region node
export class ClassifyNode implements NodeInterface<ChatState, 'on_topic' | 'off_topic'> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'classify';
  readonly outputs = ['on_topic', 'off_topic'] as const;

  async execute(state: ChatState) {
    // Pick an output key based on input content; the DAG placement
    // routes that key to the next node name.
    state.topic = state.input.toLowerCase().includes('weather')
      ? 'off_topic'
      : 'on_topic';
    return NodeOutputBuilder.of(state.topic);
  }
}

export class RespondNode implements NodeInterface<ChatState, 'success'> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'respond';
  readonly outputs = ['success'] as const;

  async execute(state: ChatState) {
    state.reply = state.topic === 'on_topic'
      ? `Echo: ${state.input}`
      : `I only talk about coding, not the weather.`;
    return NodeOutputBuilder.of('success');
  }
}
// #endregion node

// #region dag
export const dag: DAG = {
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
