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
  Batch,
  DAGBuilder,
    MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';
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

export const chatDAGIri = 'urn:noocodec:dag:chat' as const;
const typeSafeDAGIri = 'urn:noocodec:dag:type-safe-demo' as const;
const notifyDAGIri = 'urn:noocodec:dag:notify' as const;
const searchDAGIri = 'urn:noocodec:dag:search' as const;
const batchDAGIri = 'urn:noocodec:dag:batch' as const;
const demoDAGIri = 'urn:noocodec:dag:dag' as const;

const placement = (dagIri: string, placementIdentifier: string): string => `${dagIri}/node/${placementIdentifier}`;

// #region nodes
export class ClassifyNode extends MonadicNode<ChatState, 'on_topic' | 'off_topic'> {
  readonly name = 'classify';
  readonly '@id' = 'urn:noocodec:node:classify';
  readonly outputs = ['on_topic', 'off_topic'] as const;
  override get outputSchema(): Record<'on_topic' | 'off_topic', SchemaObjectType> {
    return { 'on_topic': { 'type': 'object' }, 'off_topic': { 'type': 'object' } };
  }

  override async execute(batch: Batch<ChatState>) {
    const entries: Array<readonly ['on_topic' | 'off_topic', Batch<ChatState>]> = [];
    for (const item of batch) {
      const state = item.state;
      state.topic = state.input.toLowerCase().includes('weather') ? 'off_topic' : 'on_topic';
      const output = NodeOutput.create(state.topic);
      for (const error of output.errors) state.collectError(error);
      entries.push([output.output, Batch.from([item])]);
    }
    return RoutedBatch.create(entries);
  }
}

export class RespondNode extends MonadicNode<ChatState, 'success'> {
  readonly name = 'respond';
  readonly '@id' = 'urn:noocodec:node:respond';
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
// #endregion nodes

// ---------------------------------------------------------------------------
// DAG: built via DAGBuilder instead of a literal object
//
// DAGBuilder(dagIri, 'version', { name: 'display-name' })
//   .node(placementIri, nodeRef, routes, { name: 'display-name' })  ← first call auto-sets entrypoint
//   .node(placementIri, nodeRef, routes, { name: 'display-name' })
//   .build()
//
// routes must cover every key of node's TOutput; TypeScript enforces this.
// Missing a key is a compile error; extra keys are also a compile error.
// ---------------------------------------------------------------------------

// #region builder
export const dag = new DAGBuilder(chatDAGIri, '1')
  // First .node() call → entrypoint is set to 'classify' automatically.
  .node(placement(chatDAGIri, 'classify'), new ClassifyNode(), {
    "on_topic": placement(chatDAGIri, 'respond'),
    "off_topic": placement(chatDAGIri, 'respond'),
  })
  // routes for 'respond' must cover exactly { success }, no more, no less.
  .node(placement(chatDAGIri, 'respond'), new RespondNode(), { "success": placement(chatDAGIri, 'end') })
  .terminal(placement(chatDAGIri, 'end'))
  .build();  // materialises the canonical JSON-LD DAG document
// #endregion builder

// ---------------------------------------------------------------------------
// Type-safe output routing: TOutput union enforces exhaustive routes
// ---------------------------------------------------------------------------

// #region type-safe-routing
// ClassifyNode declares TOutput = 'on_topic' | 'off_topic'.
// Every key of the union must appear in the routes map — TypeScript enforces
// exhaustiveness. A missing key is a compile error before the DAG runs.
export const typeSafeRoutingDag = new DAGBuilder(typeSafeDAGIri, '1')
  .node(placement(typeSafeDAGIri, 'classify'), new ClassifyNode(), {
    on_topic:  placement(typeSafeDAGIri, 'respond'),
    off_topic: placement(typeSafeDAGIri, 'respond'),
    //  omitting either key ↑ is a TS compile error: property missing in routes
  })
  .node(placement(typeSafeDAGIri, 'respond'), new RespondNode(), { success: placement(typeSafeDAGIri, 'end') })
  .terminal(placement(typeSafeDAGIri, 'end'))
  .build();
// #endregion type-safe-routing

// ---------------------------------------------------------------------------
// Scatter: side-effect-only fan-out (strategy: 'discard')
// ---------------------------------------------------------------------------

class NotifyNode extends MonadicNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-notify';
  readonly '@id' = 'urn:noocodec:node:builder-notify';
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// #region scatter-discard
// Side-effect-only fan-out: no GatherNode is wired after scatter, so clone
// state does not flow back into the parent.
export const scatterDiscardDag = new DAGBuilder(notifyDAGIri, '1')
  .scatter(
    placement(notifyDAGIri, 'fan-out'),
    'targets',
    new NotifyNode(),
    {
      'all-success': placement(notifyDAGIri, 'end'),
      'partial': placement(notifyDAGIri, 'end'),
      'all-error': placement(notifyDAGIri, 'end'),
      'empty': placement(notifyDAGIri, 'end'),
    },
    {
      execution: { mode: 'item', concurrency: 10 },
    },
  )
  .terminal(placement(notifyDAGIri, 'end'))
  .build();
// #endregion scatter-discard

// ---------------------------------------------------------------------------
// Scatter: heterogeneous fan-out (dispatch node reads currentItem)
// ---------------------------------------------------------------------------

class ScoutDispatchNode extends MonadicNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-scout-dispatch';
  readonly '@id' = 'urn:noocodec:node:builder-scout-dispatch';
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

class MergeNode extends MonadicNode<ChatState, 'success'> {
  readonly name = 'builder-merge';
  readonly '@id' = 'urn:noocodec:node:builder-merge';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// #region scatter-heterogeneous
// Heterogeneous fan-out: ScoutDispatchNode reads state.metadata.currentItem
// to route per-provider logic. The engine is indifferent to whether each clone
// runs identical or different logic; that is the implementer's choice.
export const scatterHeterogeneousDag = new DAGBuilder(searchDAGIri, '1')
  .scatter(
    placement(searchDAGIri, 'scout'),
    'scoutProviders',          // state field: ['openlibrary', 'googlebooks', 'wikipedia']
    new ScoutDispatchNode(),
    {
      'any-success': placement(searchDAGIri, 'collect-scout-results'),
      'all-error': placement(searchDAGIri, 'end'),
      'empty': placement(searchDAGIri, 'end'),
    },
    {
      reducer:     'any-success',
      execution: { mode: 'item', concurrency: 3 },
    },
  )
  .gather(
    placement(searchDAGIri, 'collect-scout-results'),
    { [placement(searchDAGIri, 'scout')]: {} },
    { strategy: 'collect', target: 'scoutResults' },
    {
      success: placement(searchDAGIri, 'merge'),
      error: placement(searchDAGIri, 'end'),
      empty: placement(searchDAGIri, 'end'),
    },
  )
  .node(placement(searchDAGIri, 'merge'), new MergeNode(), { success: placement(searchDAGIri, 'end') })
  .terminal(placement(searchDAGIri, 'end'))
  .build();
// #endregion scatter-heterogeneous

// ---------------------------------------------------------------------------
// Scatter: generate-collect pattern (strategy: 'map')
// ---------------------------------------------------------------------------

class GenerateNode extends MonadicNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-generate';
  readonly '@id' = 'urn:noocodec:node:builder-generate';
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

class SelectNode extends MonadicNode<ChatState, 'success'> {
  readonly name = 'builder-select';
  readonly '@id' = 'urn:noocodec:node:builder-select';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// #region scatter-map
// Generate-collect: each clone produces one artifact; gather.mapping writes
// produced artifacts back to the parent keyed by source index. The 'candidate'
// clone field accumulates into the parent's 'candidates' array.
export const scatterMapDag = new DAGBuilder(batchDAGIri, '1')
  .scatter(
    placement(batchDAGIri, 'generate'),
    'providers',
    new GenerateNode(),
    {
      'all-success': placement(batchDAGIri, 'collect-candidates'),
      'partial': placement(batchDAGIri, 'collect-candidates'),
      'all-error': placement(batchDAGIri, 'end'),
      'empty': placement(batchDAGIri, 'end'),
    },
    {
      execution: { mode: 'item', concurrency: 4 },
    },
  )
  .gather(
    placement(batchDAGIri, 'collect-candidates'),
    { [placement(batchDAGIri, 'generate')]: {} },
    { strategy: 'map', mapping: { 'candidate': 'candidates' } },
    {
      success: placement(batchDAGIri, 'select'),
      error: placement(batchDAGIri, 'end'),
      empty: placement(batchDAGIri, 'end'),
    },
  )
  .node(placement(batchDAGIri, 'select'), new SelectNode(), { success: placement(batchDAGIri, 'end') })
  .terminal(placement(batchDAGIri, 'end'))
  .build();
// #endregion scatter-map

// ---------------------------------------------------------------------------
// Scatter: partition strategy (group clones by output token)
// ---------------------------------------------------------------------------

class ProcessNode extends MonadicNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-process';
  readonly '@id' = 'urn:noocodec:node:builder-process';
  readonly outputs = ['success', 'error'] as const;
  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return { 'success': { 'type': 'object' }, 'error': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// #region scatter-partition
// gather.strategy 'partition' groups clone results by their output token.
// Each partition key maps to a parent-state field that receives matching clones.
export const scatterPartitionDag = new DAGBuilder(batchDAGIri, '1')
  .scatter(
    placement(batchDAGIri, 'process-items'),
    'items',
    new ProcessNode(),
    {
      'all-success': placement(batchDAGIri, 'partition-results'),
      'partial': placement(batchDAGIri, 'partition-results'),
      'all-error': placement(batchDAGIri, 'partition-results'),
      'empty': placement(batchDAGIri, 'end'),
    },
    {
      execution: { mode: 'item', concurrency: 4 },
    },
  )
  .gather(
    placement(batchDAGIri, 'partition-results'),
    { [placement(batchDAGIri, 'process-items')]: {} },
    { strategy: 'partition', partitions: { success: 'processed', error: 'failed' } },
    {
      success: placement(batchDAGIri, 'end'),
      error: placement(batchDAGIri, 'end'),
      empty: placement(batchDAGIri, 'end'),
    },
  )
  .terminal(placement(batchDAGIri, 'end'))
  .build();
// #endregion scatter-partition

// ---------------------------------------------------------------------------
// Scatter: inputs field (parent → clone field copy via dotted path)
// ---------------------------------------------------------------------------

// #region scatter-inputs
// inputs copies parent-state fields into each clone before the body runs.
// Keys are child-state field names; values are parent-state dotted paths.
// Path<TState> enumerates valid dotted paths (e.g. 'user', 'user.name').
export const scatterInputsDag = new DAGBuilder(chatDAGIri, '1')
  .scatter(
    placement(chatDAGIri, 'classify-all'),
    'inputs',
    new ClassifyNode(),
    {
      'all-success': placement(chatDAGIri, 'respond'),
      'partial': placement(chatDAGIri, 'respond'),
      'all-error': placement(chatDAGIri, 'end'),
      'empty': placement(chatDAGIri, 'end'),
    },
    {
      inputs:  { 'input': 'input' },   // clone.input ← parent.input (dotted path)
    },
  )
  .node(placement(chatDAGIri, 'respond'), new RespondNode(), { success: placement(chatDAGIri, 'end') })
  .terminal(placement(chatDAGIri, 'end'))
  .build();
// #endregion scatter-inputs

// ---------------------------------------------------------------------------
// .entrypoints() override
// ---------------------------------------------------------------------------

class SetupNode extends MonadicNode<ChatState, 'success'> {
  readonly name = 'builder-setup';
  readonly '@id' = 'urn:noocodec:node:builder-setup';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

class MainNode extends MonadicNode<ChatState, 'success'> {
  readonly name = 'builder-main';
  readonly '@id' = 'urn:noocodec:node:builder-main';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }
  override async execute(batch: Batch<ChatState>) {
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// #region entrypoint-override
// By default the first .node() call sets the entrypoint automatically.
// Call .entrypoints({ main: placementIri }) to override — useful when resuming from a mid-flow
// checkpoint or when adding setup nodes that should be skipped on replay.
export const entrypointOverrideDag = new DAGBuilder(demoDAGIri, '1')
  .node(placement(demoDAGIri, 'setup'), new SetupNode(), { success: placement(demoDAGIri, 'main') })
  .node(placement(demoDAGIri, 'main'),  new MainNode(),  { success: placement(demoDAGIri, 'end')  })
  .entrypoints({ main: placement(demoDAGIri, 'main') })   // skip 'setup' on resume; 'main' becomes the entry
  .terminal(placement(demoDAGIri, 'end'))
  .build();
// #endregion entrypoint-override
