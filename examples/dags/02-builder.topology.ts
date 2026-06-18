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
  DAGError,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { OperationContractFragment, WarningEmitter } from '@studnicky/dagonizer/contracts';
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

// ---------------------------------------------------------------------------
// Type-safe output routing: TOutput union enforces exhaustive routes
// ---------------------------------------------------------------------------

// #region type-safe-routing
// ClassifyNode declares TOutput = 'on_topic' | 'off_topic'.
// Every key of the union must appear in the routes map — TypeScript enforces
// exhaustiveness. A missing key is a compile error before the DAG runs.
export const typeSafeRoutingDag = new DAGBuilder('type-safe-demo', '1')
  .node('classify', new ClassifyNode(), {
    on_topic:  'respond',
    off_topic: 'respond',
    //  omitting either key ↑ is a TS compile error: property missing in routes
  })
  .node('respond', new RespondNode(), { success: 'end' })
  .terminal('end')
  .build();
// #endregion type-safe-routing

// ---------------------------------------------------------------------------
// Contract-aware authoring: dangling read → DAGError at build() time
// ---------------------------------------------------------------------------

class ContractFetchNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'contract-fetch';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: [], produces: ['raw'] };
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

class ContractParseNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'contract-parse';
  readonly outputs = ['success'] as const;
  // Deliberate mismatch: hardRequires 'data' but upstream only produces 'raw'.
  override readonly contract: OperationContractFragment = { hardRequired: ['data'], produces: ['record'] };
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region contract-error
// Nodes with mismatched contracts: ContractFetchNode produces 'raw';
// ContractParseNode hardRequires 'data'. DAGBuilder.build() detects the
// dangling read and throws DAGError at construction time, not run time.
export function contractErrorDemo(): void {
  try {
    new DAGBuilder('pipeline', '1.0')
      .node('contract-fetch', new ContractFetchNode(), { success: 'contract-parse' })
      .node('contract-parse', new ContractParseNode(), { success: 'contract-end' })
      .terminal('contract-end')
      .build();
  } catch (err) {
    if (err instanceof DAGError) process.stdout.write(`DAGError: ${err.message}\n`);
  }
}
// #endregion contract-error

// ---------------------------------------------------------------------------
// Contract-aware authoring: dead write → warningEmitter (non-fatal)
// ---------------------------------------------------------------------------

class WarningFetchNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'warning-fetch';
  readonly outputs = ['success'] as const;
  // 'orphan' is produced but nothing hardRequires it → dead write warning.
  override readonly contract: OperationContractFragment = { hardRequired: [], produces: ['raw', 'orphan'] };
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

class WarningParseNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'warning-parse';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: ['raw'], produces: ['record'] };
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region contract-warning
// Pass a warningEmitter to build() to capture dead-write contract warnings.
// 'orphan' is produced by WarningFetchNode but no downstream node hardRequires it.
export function contractWarningDemo(): void {
  const emitter: WarningEmitter = {
    warn(message) { process.stdout.write(`[contract] ${message}\n`); },
  };

  new DAGBuilder('pipeline', '1.0')
    .node('warning-fetch', new WarningFetchNode(), { success: 'warning-parse' })
    .node('warning-parse', new WarningParseNode(), { success: 'warning-end' })
    .terminal('warning-end')
    .build({ warningEmitter: emitter });
}
// #endregion contract-warning

// ---------------------------------------------------------------------------
// DAGBuilder.fromNodes(): linear shortcut for contract-carrying node chains
// ---------------------------------------------------------------------------

class LinearFetchNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'linear-fetch';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: [], produces: ['raw'] };
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

class LinearParseNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'linear-parse';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: ['raw'], produces: ['record'] };
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

class LinearSaveNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'linear-save';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = { hardRequired: ['record'], produces: [] };
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region from-nodes
// DAGBuilder.fromNodes() delegates to DAGDeriver.derive. Use it when the flow
// is linear and every node carries a contract. The deriver infers the topology
// from hardRequired / produces declarations; no explicit routes are needed.
// annotations.terminals declares the terminal node for the last operation's output.
export const fromNodesDag = DAGBuilder.fromNodes(
  'linear-pipeline',
  '1.0',
  'linear-fetch',
  [new LinearFetchNode(), new LinearParseNode(), new LinearSaveNode()],
  {
    annotations: {
      terminals: {
        'linear-save': [{ outcome: 'success', emit: { name: 'end', outcome: 'completed' } }],
      },
    },
  },
);
// #endregion from-nodes

// #region from-nodes-fluent
// Equivalent fluent form using the explicit .node() chain:
export const fromNodesFluent = new DAGBuilder('linear-pipeline', '1.0')
  .node('linear-fetch', new LinearFetchNode(), { success: 'linear-parse' })
  .node('linear-parse', new LinearParseNode(), { success: 'linear-save' })
  .node('linear-save',  new LinearSaveNode(),  { success: 'linear-end'  })
  .terminal('linear-end')
  .build();
// #endregion from-nodes-fluent

// ---------------------------------------------------------------------------
// Scatter: side-effect-only fan-out (strategy: 'discard')
// ---------------------------------------------------------------------------

class NotifyNode extends ScalarNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-notify';
  readonly outputs = ['success', 'error'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region scatter-discard
// Side-effect-only fan-out: gather.strategy 'discard' means no clone state
// flows back into the parent. Use for notifications, fire-and-forget writes.
export const scatterDiscardDag = new DAGBuilder('notify', '1')
  .scatter(
    'fan-out',
    'targets',
    new NotifyNode(),
    { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    {
      gather:      { strategy: 'discard' },
      concurrency: 10,
    },
  )
  .terminal('end')
  .build();
// #endregion scatter-discard

// ---------------------------------------------------------------------------
// Scatter: heterogeneous fan-out (dispatch node reads currentItem)
// ---------------------------------------------------------------------------

class ScoutDispatchNode extends ScalarNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-scout-dispatch';
  readonly outputs = ['success', 'error'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

class MergeNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'builder-merge';
  readonly outputs = ['success'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region scatter-heterogeneous
// Heterogeneous fan-out: ScoutDispatchNode reads state.metadata.currentItem
// to route per-provider logic. The engine is indifferent to whether each clone
// runs identical or different logic; that is the implementer's choice.
export const scatterHeterogeneousDag = new DAGBuilder('search', '1')
  .scatter(
    'scout',
    'scoutProviders',          // state field: ['openlibrary', 'googlebooks', 'wikipedia']
    new ScoutDispatchNode(),
    { 'any-success': 'merge', 'all-error': 'end', 'empty': 'end' },
    {
      gather:      { strategy: 'collect', target: 'scoutResults' },
      reducer:     'any-success',
      concurrency: 3,
    },
  )
  .node('merge', new MergeNode(), { success: 'end' })
  .terminal('end')
  .build();
// #endregion scatter-heterogeneous

// ---------------------------------------------------------------------------
// Scatter: generate-collect pattern (strategy: 'map')
// ---------------------------------------------------------------------------

class GenerateNode extends ScalarNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-generate';
  readonly outputs = ['success', 'error'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

class SelectNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'builder-select';
  readonly outputs = ['success'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region scatter-map
// Generate-collect: each clone produces one artifact; gather.mapping writes
// produced artifacts back to the parent keyed by source index. The 'candidate'
// clone field accumulates into the parent's 'candidates' array.
export const scatterMapDag = new DAGBuilder('batch', '1')
  .scatter(
    'generate',
    'providers',
    new GenerateNode(),
    { 'all-success': 'select', 'partial': 'select', 'all-error': 'end', 'empty': 'end' },
    {
      gather:      { strategy: 'map', mapping: { 'candidate': 'candidates' } },
      concurrency: 4,
    },
  )
  .node('select', new SelectNode(), { success: 'end' })
  .terminal('end')
  .build();
// #endregion scatter-map

// ---------------------------------------------------------------------------
// Scatter: partition strategy (group clones by output token)
// ---------------------------------------------------------------------------

class ProcessNode extends ScalarNode<ChatState, 'success' | 'error'> {
  readonly name = 'builder-process';
  readonly outputs = ['success', 'error'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region scatter-partition
// gather.strategy 'partition' groups clone results by their output token.
// Each partition key maps to a parent-state field that receives matching clones.
export const scatterPartitionDag = new DAGBuilder('batch', '1')
  .scatter(
    'process-items',
    'items',
    new ProcessNode(),
    { 'all-success': 'end', 'partial': 'end', 'all-error': 'end', 'empty': 'end' },
    {
      gather:      { strategy: 'partition', partitions: { success: 'processed', error: 'failed' } },
      concurrency: 4,
    },
  )
  .terminal('end')
  .build();
// #endregion scatter-partition

// ---------------------------------------------------------------------------
// Scatter: inputs field (parent → clone field copy via dotted path)
// ---------------------------------------------------------------------------

// #region scatter-inputs
// inputs copies parent-state fields into each clone before the body runs.
// Keys are child-state field names; values are parent-state dotted paths.
// Path<TState> enumerates valid dotted paths (e.g. 'user', 'user.name').
export const scatterInputsDag = new DAGBuilder('chat', '1')
  .scatter(
    'classify-all',
    'inputs',
    new ClassifyNode(),
    { 'all-success': 'respond', 'partial': 'respond', 'all-error': 'end', 'empty': 'end' },
    {
      gather:  { strategy: 'discard' },
      inputs:  { 'input': 'input' },   // clone.input ← parent.input (dotted path)
    },
  )
  .node('respond', new RespondNode(), { success: 'end' })
  .terminal('end')
  .build();
// #endregion scatter-inputs

// ---------------------------------------------------------------------------
// .entrypoint() override
// ---------------------------------------------------------------------------

class SetupNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'builder-setup';
  readonly outputs = ['success'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

class MainNode extends ScalarNode<ChatState, 'success'> {
  readonly name = 'builder-main';
  readonly outputs = ['success'] as const;
  protected override async executeOne() { return NodeOutputBuilder.of('success' as const); }
}

// #region entrypoint-override
// By default the first .node() call sets the entrypoint automatically.
// Call .entrypoint(name) to override — useful when resuming from a mid-flow
// checkpoint or when adding setup nodes that should be skipped on replay.
export const entrypointOverrideDag = new DAGBuilder('dag', '1')
  .node('setup', new SetupNode(), { success: 'main' })
  .node('main',  new MainNode(),  { success: 'end'  })
  .entrypoint('main')   // skip 'setup' on resume; 'main' becomes the entry
  .terminal('end')
  .build();
// #endregion entrypoint-override
