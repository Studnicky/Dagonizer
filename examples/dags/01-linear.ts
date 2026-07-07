/**
 * 01-linear/dags: pure module — state, nodes, and DAG const.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/01-linear.ts (the executable entry point).
 */

// #region imports
import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
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
export class ClassifyNode extends MonadicNode<ChatState, 'on_topic' | 'off_topic'> {
  readonly name = 'classify';
  readonly outputs = ['on_topic', 'off_topic'] as const;
  override get outputSchema(): Record<'on_topic' | 'off_topic', SchemaObjectType> {
    return { 'on_topic': { 'type': 'object' }, 'off_topic': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ChatState>) {
    const entries: Array<readonly ['on_topic' | 'off_topic', Batch<ChatState>]> = [];
    for (const item of batch) {
      const state = item.state;
      // Pick an output key based on input content; the DAG placement routes
      // matching batch items to the next node name.
      state.topic = state.input.toLowerCase().includes('weather')
        ? 'off_topic'
        : 'on_topic';
      const output = NodeOutput.create(state.topic);
      for (const error of output.errors) state.collectError(error);
      entries.push([output.output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

export class RespondNode extends MonadicNode<ChatState, 'success'> {
  readonly name = 'respond';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ChatState>) {
    for (const item of batch) {
      const state = item.state;
      state.reply = state.topic === 'on_topic'
        ? `Echo: ${state.input}`
        : `I only talk about coding, not the weather.`;
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
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
  "entrypoints": { "main": 'classify' },                          // first placement to execute
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
