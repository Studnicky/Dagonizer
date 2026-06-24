/**
 * 33-plugin/dags: pure module — state, nodes, DAG, and plugin class.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/33-plugin.ts (the executable entry point).
 */

// #region imports
import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { DAGType, DispatcherBundleType, NodeStateInterface, PluginInterface, PluginReceiverType, SchemaObjectType } from '@studnicky/dagonizer';
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
export class NormalizeNode extends ScalarNode<PipelineState, 'done'> {
  readonly name = 'normalize';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { done: { type: 'object' } };
  }

  protected override async executeOne(state: PipelineState) {
    state.normalized = state.phrase.trim().toLowerCase();
    return NodeOutputBuilder.of('done');
  }
}

/**
 * SummarizeNode: sets a status tag based on the normalized phrase length.
 * Registered alongside NormalizeNode in the plugin bundle.
 */
export class SummarizeNode extends ScalarNode<PipelineState, 'done'> {
  readonly name = 'summarize';
  readonly outputs = ['done'] as const;
  override get outputSchema(): Record<'done', SchemaObjectType> {
    return { done: { type: 'object' } };
  }

  protected override async executeOne(state: PipelineState) {
    state.status = state.normalized.length > 20 ? 'long' : 'short';
    return NodeOutputBuilder.of('done');
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
// Plugin: implements PluginInterface, ships nodes + DAG as a unit
// ---------------------------------------------------------------------------

// #region plugin
/**
 * NormalizePlugin: a self-contained plugin that registers its nodes and DAG on
 * any dispatcher via a single `registerPlugin(new NormalizePlugin())` call.
 *
 * Implements `PluginInterface` — the `register` method receives the dispatcher's
 * narrow `PluginReceiverType` (only `registerBundle` is visible) and calls it.
 */
export class NormalizePlugin implements PluginInterface {
  /** Build the bundle this plugin contributes. */
  private bundle(): DispatcherBundleType<NodeStateInterface> {
    return {
      nodes: [new NormalizeNode(), new SummarizeNode()],
      dags:  [pluginDag],
    };
  }

  register(dispatcher: PluginReceiverType): void {
    dispatcher.registerBundle(this.bundle());
  }
}
// #endregion plugin

// ---------------------------------------------------------------------------
// Parent DAG: embeds the plugin's sub-DAG via EmbeddedDAGNode
// ---------------------------------------------------------------------------

// #region parent-dag
/** Top-level DAG that embeds the plugin's sub-DAG. */
export const parentDag: DAGType = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:pipeline',
  '@type':     'DAG',
  name:        'pipeline',
  version:     '1',
  entrypoint:  'normalize-step',
  nodes: [
    {
      '@id':    'urn:noocodex:dag:pipeline/node/normalize-step',
      '@type':  'EmbeddedDAGNode',
      name:     'normalize-step',
      dag:      'plugin-normalize',
      outputs:  { success: 'end', error: 'end' },
      stateMapping: {
        input:  { 'phrase': 'phrase' },
        output: { 'normalized': 'normalized', 'status': 'status' },
      },
    },
    {
      '@id':    'urn:noocodex:dag:pipeline/node/end',
      '@type':  'TerminalNode',
      name:     'end',
      outcome:  'completed',
    },
  ],
};
// #endregion parent-dag
