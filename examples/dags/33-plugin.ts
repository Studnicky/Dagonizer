/**
 * 33-plugin/dags: pure module — state, nodes, DAG, and plugin class.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/33-plugin.ts (the executable entry point).
 */

// #region imports
import {
  Batch,
  DAGBuilder,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import { defineDagonizerPlugin } from '@studnicky/dagonizer/plugin';
import type { DAGType, SchemaObjectType } from '@studnicky/dagonizer';
// #endregion imports

// #region state
/** Pipeline state for the 33-plugin example. */
export class PipelineState extends NodeStateBase {
  /** Input phrase supplied before execute. */
  phrase = '';
  /** Normalized output written by the normalize node. */
  normalized = '';
  /** Status tag written by the summarize node. */
  status = '';
}
// #endregion state

// ---------------------------------------------------------------------------
// Nodes (registered by the plugin bundle)
// ---------------------------------------------------------------------------

// #region plugin-nodes
/**
 * NormalizeNode: converts the input phrase to lower-case and trims whitespace.
 * This node lives inside the plugin bundle — the consumer never registers it
 * directly; the plugin takes care of that.
 */
export class NormalizeNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'normalize';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { done: { type: 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.normalized = item.state.phrase.trim().toLowerCase();
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}

/**
 * SummarizeNode: sets a status tag based on the normalized phrase length.
 * Registered alongside NormalizeNode in the plugin bundle.
 */
export class SummarizeNode extends MonadicNode<PipelineState, 'done'> {
  readonly name = 'summarize';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { done: { type: 'object' } };
  }

  override async execute(batch: Batch<PipelineState>) {
    for (const item of batch) {
      item.state.status = item.state.normalized.length > 20 ? 'long' : 'short';
    }
    return RoutedBatch.create(NodeOutput.create('done').output, batch);
  }
}
// #endregion plugin-nodes

// ---------------------------------------------------------------------------
// Sub-DAG (registered by the plugin bundle as an embedded DAG body)
// ---------------------------------------------------------------------------

// #region plugin-dag
/** Sub-DAG that the plugin registers. Entry point of the plugin's functionality. */
export const pluginDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:plugin-normalize',
  '@type':     'DAG',
  name:        'plugin-normalize',
  version:     '1',
  entrypoint:  'normalize',
  nodes: [
    {
      '@id':    'urn:noocodex:dag:plugin-normalize/node/normalize',
      '@type':  'SingleNode',
      name:     'normalize',
      node:     'normalize',
      outputs:  { done: 'summarize' },
    },
    {
      '@id':    'urn:noocodex:dag:plugin-normalize/node/summarize',
      '@type':  'SingleNode',
      name:     'summarize',
      node:     'summarize',
      outputs:  { done: 'end' },
    },
    {
      '@id':    'urn:noocodex:dag:plugin-normalize/node/end',
      '@type':  'TerminalNode',
      name:     'end',
      outcome:  'completed',
    },
  ],
};
// #endregion plugin-dag

// ---------------------------------------------------------------------------
// Plugin: ships nodes + DAG as one registry-scoped bundle
// ---------------------------------------------------------------------------

// #region plugin
/**
 * normalizePlugin: a self-contained plugin that registers its nodes and DAG on
 * any dispatcher via a single `registerPlugin(normalizePlugin)` call.
 */
export const normalizePlugin = defineDagonizerPlugin({
  context: {
    plugin: 'https://noocodex.dev/plugins/normalize#',
  },
  nodes: [new NormalizeNode(), new SummarizeNode()],
  dags: [pluginDag],
  exports: {
    normalize: 'plugin-normalize',
  },
});
// #endregion plugin

// ---------------------------------------------------------------------------
// Parent DAG: embeds the plugin's sub-DAG via EmbeddedDAGNode
// ---------------------------------------------------------------------------

// #region parent-dag
/** Top-level DAG that embeds the plugin's sub-DAG. */
const parentBuilder = new DAGBuilder('pipeline', '1');
parentBuilder.embed('normalize-step', normalizePlugin.exports.normalize, { success: 'end', error: 'end' }, {
  inputs: { phrase: 'phrase' },
  outputs: { normalized: 'normalized', status: 'status' },
});
parentBuilder.terminal('end');

export const parentDag: DAGType = parentBuilder.build();
// #endregion parent-dag
