/**
 * derive/dags: pure module — state, nodes, and derived DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/derive.ts (the executable entry point).
 *
 * Uses DAGDeriver.derive: each operation declares what it needs
 * (`hardRequired`) and what it produces (`produces`); the deriver matches
 * produces ↔ hardRequired to derive the topology. The embeddedDAGs
 * annotation renders invoke-plugin as an EmbeddedDAGNode whose `dag` runs
 * the child DAG.
 */

import { DAGDeriver } from '@noocodex/dagonizer/derive';
import { Dagonizer, NodeOutputBuilder, NodeStateBase, ScalarNode } from '@noocodex/dagonizer';
import type { OperationContract } from '@noocodex/dagonizer/contracts';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';
import type { Chainable } from '@noocodex/dagonizer/contracts';
import type { DAGDeriverAnnotations, DAGDeriverEmbeddedDAG } from '@noocodex/dagonizer/derive';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class PipelineState extends NodeStateBase {
  input        = '';
  intermediate = '';
  childResult  = '';
  final        = '';
}

// ---------------------------------------------------------------------------
// Nodes: class-per-node, extends ScalarNode
// ---------------------------------------------------------------------------

export class PrepareNode extends ScalarNode<PipelineState, 'success'> {
  readonly name     = 'prepare';
  readonly outputs  = ['success'] as const;
  override readonly contract: OperationContractFragment ={ "hardRequired": ['input'], "produces": ['intermediate'] };

  protected override async executeOne(state: PipelineState) {
    state.intermediate = state.input.toUpperCase();
    return NodeOutputBuilder.of('success');
  }
}

export class ValidateNode extends ScalarNode<PipelineState, 'success' | 'error'> {
  readonly name     = 'validate';
  readonly outputs  = ['success', 'error'] as const;
  override readonly contract: OperationContractFragment ={ "hardRequired": ['intermediate'], "produces": ['validated'] };

  protected override async executeOne(state: PipelineState) {
    if (state.intermediate.length === 0) return NodeOutputBuilder.of('error');
    return NodeOutputBuilder.of('success');
  }
}

export class TransformNode extends ScalarNode<PipelineState, 'success'> {
  readonly name     = 'transform';
  readonly outputs  = ['success'] as const;
  override readonly contract: OperationContractFragment ={ "hardRequired": ['validated'], "produces": ['childResult'] };

  protected override async executeOne(state: PipelineState) {
    state.childResult = `[${state.intermediate}]`;
    return NodeOutputBuilder.of('success');
  }
}

export class InvokePluginNode extends ScalarNode<PipelineState, 'success' | 'error'> {
  // invoke-plugin carries the contract (hardRequired/produces) the deriver
  // uses to place this stage in the topology. The embeddedDAGs annotation
  // renders it as an EmbeddedDAGNode whose `dag` runs the child DAG;
  // so this `execute` does not run; the sub-DAG does the work.
  // Its `outputs` declare the ports the EmbeddedDAGNode routes on.
  readonly name     = 'invoke-plugin';
  readonly outputs  = ['success', 'error'] as const;
  override readonly contract: OperationContractFragment ={ "hardRequired": ['intermediate'], "produces": ['childResult'] };

  protected override async executeOne(_state: PipelineState) {
    return NodeOutputBuilder.of('success');
  }
}

export class FinalizeNode extends ScalarNode<PipelineState, 'success'> {
  readonly name     = 'finalize';
  readonly outputs  = ['success'] as const;
  override readonly contract: OperationContractFragment ={ "hardRequired": ['childResult'], "produces": ['final'] };

  protected override async executeOne(state: PipelineState) {
    state.final = `done: ${state.childResult}`;
    return NodeOutputBuilder.of('success');
  }
}

// ---------------------------------------------------------------------------
// Derive the DAGs
// ---------------------------------------------------------------------------

// Node instances used for DAGDeriver.derive: not exported (derive consumes
// them for topology; callers instantiate fresh nodes for registration).
const prepare      = new PrepareNode();
const validate     = new ValidateNode();
const transform    = new TransformNode();
const invokePlugin = new InvokePluginNode();
const finalize     = new FinalizeNode();

// #region derive
// Child DAG: simple validate->transform chain. validate's error port
// is terminated via `terminals`; the validator is a hard gate.
// #region contracts
export const childDAG = DAGDeriver.derive({
  "name":       'plugin:transform',
  "version":    '1',
  "entrypoint": 'validate',
  "nodes":      [validate, transform],
  "annotations": {
    "terminals": {
      "validate":  [{ "outcome": 'error',   "emit": { "name": 'validate-failed', "outcome": 'failed' } }],
      // transform is the terminal stage; emit a canonical completed
      // TerminalNode so its 'success' port ends at a named placement rather
      // than a bare null end-of-flow (WellFormedValidator requires this).
      "transform": [{ "outcome": 'success', "emit": { "name": 'transformed', "outcome": 'completed' } }],
    },
  },
});
// #endregion contracts

// Parent DAG: invoke-plugin runs the child DAG via the embeddedDAGs
// annotation, which the deriver renders as an EmbeddedDAGNode.
// stateMapping.input seeds the child from the parent before it runs;
// stateMapping.output copies child fields back after it completes.
// Both `success` and `error` ports auto-wire to `finalize` (the next
// derived stage); finalize handles both paths uniformly. Per-port
// terminal overrides would route the error port elsewhere if needed.
export const parentDAG = DAGDeriver.derive({
  "name":       'parent',
  "version":    '1',
  "entrypoint": 'prepare',
  "nodes":      [prepare, invokePlugin, finalize],
  // #region annotations
  "annotations": {
    "embeddedDAGs": {
      "invoke-plugin": {
        "dag":     'plugin:transform',
        "outputs": ['success', 'error'],
        "stateMapping": {
          "input":  { "intermediate": 'intermediate' },
          "output": { "childResult":  'childResult' },
        },
      },
    },
    "terminals": {
      // finalize is the terminal stage; emit a canonical completed
      // TerminalNode so its 'success' port ends at a named placement rather
      // than a bare null end-of-flow (WellFormedValidator requires this).
      "finalize": [{ "outcome": 'success', "emit": { "name": 'finalized', "outcome": 'completed' } }],
    },
  },
  // #endregion annotations
});
// #endregion derive

// ---------------------------------------------------------------------------
// OperationContract: full four-field form (name + hardRequired + produces + outputs)
// ---------------------------------------------------------------------------

// #region operation-contract
// Full OperationContract: name + hardRequired + produces + outputs.
// Used when contracts are managed as a separate registry rather than
// co-located on the node. DAGDeriver.derive({ nodes }) projects these
// automatically via extractContracts; this form is for tooling and display.
const classifyContract: OperationContract = {
  name:         'classify',
  hardRequired: ['input'],
  produces:     ['classification'],
  outputs:      ['success', 'off-topic'],
};

// Silence "unused variable" without side effects.
void classifyContract;
// #endregion operation-contract

// ---------------------------------------------------------------------------
// terminals: target variant — re-route a port to an existing placement
// ---------------------------------------------------------------------------

// State and nodes for the gated flow examples below.
class GatedState extends NodeStateBase {
  input          = '';
  classification = '';
  plan           = '';
}

class GatedClassifyNode extends ScalarNode<GatedState, 'success' | 'off-topic' | 'error'> {
  readonly name    = 'classify';
  readonly outputs = ['success', 'off-topic', 'error'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['input'],
    produces:     ['classification'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class GatedPlanNode extends ScalarNode<GatedState, 'success'> {
  readonly name    = 'plan';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['classification'],
    produces:     ['plan'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

// #region terminals-target
// `target` variant: route the 'off-topic' port back to the 'plan' placement
// rather than terminating the flow or continuing to the auto-derived next stage.
// Both 'success' and 'off-topic' land at the same 'plan' node; 'error' emits
// a TerminalNode that marks the flow failed.
export const gatedTargetDAG = DAGDeriver.derive({
  name:       'gated-target',
  version:    '1',
  entrypoint: 'classify',
  nodes: [new GatedClassifyNode(), new GatedPlanNode()],
  annotations: {
    terminals: {
      classify: [
        { outcome: 'off-topic', target: 'plan' },
        { outcome: 'error',     emit: { name: 'classify-error', outcome: 'failed' } },
      ],
      plan: [
        { outcome: 'success', emit: { name: 'plan-done', outcome: 'completed' } },
      ],
    },
  },
});
// #endregion terminals-target

// ---------------------------------------------------------------------------
// terminals: emit variant — synthesize a TerminalNode inline
// ---------------------------------------------------------------------------

class EmitClassifyNode extends ScalarNode<GatedState, 'success' | 'fail' | 'error'> {
  readonly name    = 'classify';
  readonly outputs = ['success', 'fail', 'error'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['input'],
    produces:     ['classification'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class EmitPlanNode extends ScalarNode<GatedState, 'success'> {
  readonly name    = 'plan';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['classification'],
    produces:     ['plan'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

// #region terminals-emit
// `emit` variant: the deriver materializes TerminalNode placements for
// 'end-fail' and 'end-error'. When the dispatcher reaches either placement
// it marks the flow failed. 'success' auto-wires to the next derived stage.
export const gatedEmitDAG = DAGDeriver.derive({
  name:       'gated-emit',
  version:    '1',
  entrypoint: 'classify',
  nodes: [new EmitClassifyNode(), new EmitPlanNode()],
  annotations: {
    terminals: {
      classify: [
        { outcome: 'fail',  emit: { name: 'end-fail',  outcome: 'failed' } },
        { outcome: 'error', emit: { name: 'end-error', outcome: 'failed' } },
      ],
      plan: [
        { outcome: 'success', emit: { name: 'plan-complete', outcome: 'completed' } },
      ],
    },
  },
});
// #endregion terminals-emit

// ---------------------------------------------------------------------------
// terminals: mixing target and emit on the same operation
// ---------------------------------------------------------------------------

// #region terminals-mix
// Both variants coexist on one operation: 'retry' loops back to 'classify'
// (target), 'error' ends the flow as failed (emit).
const mixedTerminals = {
  classify: [
    { outcome: 'retry', target: 'classify' },
    { outcome: 'error', emit: { name: 'end-error', outcome: 'failed' } },
  ],
} satisfies DAGDeriverAnnotations['terminals'];

void mixedTerminals;
// #endregion terminals-mix

// ---------------------------------------------------------------------------
// scatters: custom strategy — per-item node + registered gather node
// ---------------------------------------------------------------------------

class ScatterState extends NodeStateBase {
  tasks       = '';
  currentTask = '';
  merged      = '';
  scoutResults = '';
}

class ScatterPlanNode extends ScalarNode<ScatterState, 'success'> {
  readonly name    = 'plan';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['input'],
    produces:     ['tasks'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class ScoutNode extends ScalarNode<ScatterState, 'success' | 'error'> {
  readonly name    = 'scout';
  readonly outputs = ['success', 'error'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['tasks'],
    produces:     ['scoutResults'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class MergeNode extends ScalarNode<ScatterState, 'all-success' | 'partial' | 'all-error' | 'empty'> {
  readonly name    = 'merge';
  readonly outputs = ['all-success', 'partial', 'all-error', 'empty'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['scoutResults'],
    produces:     ['merged'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('all-success'); }
}

// #region scatter-custom
// `custom` gather strategy: the 'scout' node runs once per item in
// state.tasks; 'merge' runs as the gather step via the dispatcher's gather
// reducer and receives the per-clone results map via state.metadata.gatherResults.
// concurrency: 3 caps the in-flight per-item executions to 3 at a time.
// The scatter's gather outcomes need explicit terminals because 'merge' is a
// gather step, not a successor placement in the derived topology.
export const scoutFlowDAG = DAGDeriver.derive({
  name:       'scout-flow',
  version:    '1',
  entrypoint: 'plan',
  nodes: [new ScatterPlanNode(), new ScoutNode(), new MergeNode()],
  annotations: {
    scatters: {
      scout: {
        source:      'tasks',
        itemKey:     'currentTask',
        node:        'scout',
        concurrency: 3,
        strategy:    'custom',
        customNode:  'merge',
        outcomes:    ['all-success', 'partial', 'all-error', 'empty'],
      },
    },
    terminals: {
      scout: [
        { outcome: 'all-success', emit: { name: 'scout-done',  outcome: 'completed' } },
        { outcome: 'partial',     emit: { name: 'scout-done',  outcome: 'completed' } },
        { outcome: 'all-error',   emit: { name: 'scout-error', outcome: 'failed'    } },
        { outcome: 'empty',       emit: { name: 'scout-done',  outcome: 'completed' } },
      ],
    },
  },
});
// #endregion scatter-custom

// ---------------------------------------------------------------------------
// scatters: partition strategy — per-outcome state buckets
// ---------------------------------------------------------------------------

class PartitionState extends NodeStateBase {
  tasks   = '';
  currentTask = '';
  passed  = '';
  failed  = '';
}

class PartitionPlanNode extends ScalarNode<PartitionState, 'success'> {
  readonly name    = 'plan';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['input'],
    produces:     ['tasks'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class PartitionScoutNode extends ScalarNode<PartitionState, 'success' | 'error' | 'empty'> {
  readonly name    = 'scout';
  readonly outputs = ['success', 'error', 'empty'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['tasks'],
    produces:     ['passed', 'failed'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

// #region scatter-partition
// `partition` gather strategy: items that resolved 'success' accumulate
// in state.passed; items that resolved 'error' accumulate in state.failed.
// Partition keys must be listed in `outcomes` (validated at derive time).
const partitionAnnotations = {
  scatters: {
    scout: {
      source:      'tasks',
      itemKey:     'currentTask',
      node:        'scout',
      concurrency: 0,           // 0 = unbounded; engine applies its own default
      strategy:    'partition',
      partitions:  { 'success': 'state.passed', 'error': 'state.failed' },
      outcomes:    ['success', 'error', 'empty'],
    },
  },
} satisfies DAGDeriverAnnotations;

export const partitionFlowDAG = DAGDeriver.derive({
  name:       'partition-flow',
  version:    '1',
  entrypoint: 'plan',
  nodes: [new PartitionPlanNode(), new PartitionScoutNode()],
  annotations: {
    ...partitionAnnotations,
    terminals: {
      scout: [
        { outcome: 'success', emit: { name: 'partition-done',  outcome: 'completed' } },
        { outcome: 'error',   emit: { name: 'partition-error', outcome: 'failed'    } },
        { outcome: 'empty',   emit: { name: 'partition-done',  outcome: 'completed' } },
      ],
    },
  },
});
// #endregion scatter-partition

// ---------------------------------------------------------------------------
// scatters: append strategy — single flat output array
// ---------------------------------------------------------------------------

class AppendState extends NodeStateBase {
  tasks      = '';
  currentTask = '';
  allResults = '';
}

class AppendPlanNode extends ScalarNode<AppendState, 'success'> {
  readonly name    = 'plan';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['input'],
    produces:     ['tasks'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class AppendScoutNode extends ScalarNode<AppendState, 'success' | 'error'> {
  readonly name    = 'scout';
  readonly outputs = ['success', 'error'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['tasks'],
    produces:     ['allResults'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

// #region scatter-append
// `append` gather strategy: every per-item result (regardless of outcome)
// is flattened into the array at state.allResults.
const appendAnnotations = {
  scatters: {
    scout: {
      source:      'tasks',
      itemKey:     'currentTask',
      node:        'scout',
      concurrency: 0,
      strategy:    'append',
      target:      'state.allResults',
      outcomes:    ['success', 'error'],
    },
  },
} satisfies DAGDeriverAnnotations;

export const appendFlowDAG = DAGDeriver.derive({
  name:       'append-flow',
  version:    '1',
  entrypoint: 'plan',
  nodes: [new AppendPlanNode(), new AppendScoutNode()],
  annotations: {
    ...appendAnnotations,
    terminals: {
      scout: [
        { outcome: 'success', emit: { name: 'append-done',  outcome: 'completed' } },
        { outcome: 'error',   emit: { name: 'append-error', outcome: 'failed'    } },
      ],
    },
  },
});
// #endregion scatter-append

// ---------------------------------------------------------------------------
// embeddedDAGs: page-pipeline with typed stateMapping
// ---------------------------------------------------------------------------

class PageState extends NodeStateBase {
  url    = '';
  html   = '';
  record = '';
  saved  = '';
}

class FetchNode extends ScalarNode<PageState, 'success' | 'cached' | 'error'> {
  readonly name    = 'fetch';
  readonly outputs = ['success', 'cached', 'error'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['url'],
    produces:     ['html'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class ParseNode extends ScalarNode<PageState, 'success' | 'error'> {
  readonly name    = 'parse';
  readonly outputs = ['success', 'error'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['html'],
    produces:     ['record'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class PersistNode extends ScalarNode<PageState, 'success'> {
  readonly name    = 'persist';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['record'],
    produces:     ['saved'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

// #region embedded-dag
// embeddedDAGs annotation: 'parse' delegates to a registered child DAG.
// stateMapping.input seeds child state from parent before the sub-DAG runs;
// stateMapping.output copies child fields back to parent after it completes.
// Both ports auto-wire to 'persist' (next derived stage); 'error' is
// overridden via terminals to end the flow as failed.
export const pagePipelineDAG = DAGDeriver.derive({
  name:       'page-pipeline',
  version:    '1',
  entrypoint: 'fetch',
  nodes: [new FetchNode(), new ParseNode(), new PersistNode()],
  annotations: {
    embeddedDAGs: {
      parse: {
        dag:     'aonprd:parse',
        outputs: ['success', 'error'],
        stateMapping: {
          input:  { html:   'parent.html' },
          output: { 'parent.record': 'record' },
        },
      },
    },
    terminals: {
      fetch: [
        { outcome: 'cached', target: 'persist' },
        { outcome: 'error',  emit: { name: 'fetch-failed', outcome: 'failed' } },
      ],
      parse: [
        { outcome: 'error', emit: { name: 'parse-failed', outcome: 'failed' } },
      ],
      persist: [
        { outcome: 'success', emit: { name: 'persist-done', outcome: 'completed' } },
      ],
    },
  },
});
// #endregion embedded-dag

// ---------------------------------------------------------------------------
// embeddedDAGs: typed stateMapping via DAGDeriverEmbeddedDAG<TChildState>
// ---------------------------------------------------------------------------

// #region embedded-dag-typed
// Supply TChildState to narrow stateMapping keys to names that exist on
// the child state at compile time. The generic is for authoring ergonomics
// only; the wire shape emitted to the EmbeddedDAGNode is always Record<string,string>.
class ParseChildState extends NodeStateBase {
  html   = '';
  record = '';
}

const typedEmbeddedDAG = {
  dag:     'aonprd:parse',
  outputs: ['success', 'error'],
  stateMapping: {
    input:  { html:   'parent.html' },     // 'html' must be a key of ParseChildState
    output: { 'parent.record': 'record' }, // 'record' must be a key of ParseChildState
  },
} satisfies DAGDeriverEmbeddedDAG<ParseChildState>;

void typedEmbeddedDAG;
// #endregion embedded-dag-typed

// ---------------------------------------------------------------------------
// Co-located contracts: single source of truth on the node
// ---------------------------------------------------------------------------

class ColocatedState extends NodeStateBase {
  url  = '';
  raw  = '';
  plan = '';
  done = '';
}

// #region co-located-contracts
// Contract lives on the node; single source of truth.
// name + outputs (dispatch) + contract.hardRequired/produces (topology).
class ColocatedFetchNode extends ScalarNode<ColocatedState, 'success' | 'cached' | 'error'> {
  readonly name    = 'fetch';
  readonly outputs = ['success', 'cached', 'error'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['url'],
    produces:     ['raw'],
  };
  protected override async executeOne(_state: ColocatedState) {
    return NodeOutputBuilder.of('success');
  }
}

class ColocatedPlanNode extends ScalarNode<ColocatedState, 'success'> {
  readonly name    = 'plan';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['raw'],
    produces:     ['plan'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class ColocatedExecuteNode extends ScalarNode<ColocatedState, 'success'> {
  readonly name    = 'execute';
  readonly outputs = ['success'] as const;
  override readonly contract: OperationContractFragment = {
    hardRequired: ['plan'],
    produces:     ['done'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

const fetchNode    = new ColocatedFetchNode();
const planNode     = new ColocatedPlanNode();
const executeNode  = new ColocatedExecuteNode();

// Pass the node registry; DAGDeriver projects contracts via extractContracts.
export const colocatedDAG = DAGDeriver.derive({
  name:       'pipeline',
  version:    '1',
  entrypoint: 'fetch',
  nodes: [fetchNode, planNode, executeNode],
  annotations: {
    terminals: {
      fetch: [
        { outcome: 'cached', target: 'execute' },
        { outcome: 'error',  emit: { name: 'fetch-error', outcome: 'failed' } },
      ],
      execute: [
        { outcome: 'success', emit: { name: 'pipeline-done', outcome: 'completed' } },
      ],
    },
  },
});

// Register nodes with a dispatcher.
const colocatedDispatcher = new Dagonizer<ColocatedState>();
colocatedDispatcher.registerNode(fetchNode);
colocatedDispatcher.registerNode(planNode);
colocatedDispatcher.registerNode(executeNode);
colocatedDispatcher.registerDAG(colocatedDAG);
// #endregion co-located-contracts

// ---------------------------------------------------------------------------
// extractContracts: inspect projected contracts before derivation
// ---------------------------------------------------------------------------

// #region extract-contracts
// extractContracts projects OperationContract[] from the node registry.
// Nodes carrying EMPTY_CONTRACT_FRAGMENT (both arrays empty) are skipped.
const contracts = DAGDeriver.extractContracts([fetchNode, planNode, executeNode]);
// contracts is OperationContract[]; each entry carries name, outputs, hardRequired, produces.
void contracts;
// #endregion extract-contracts

// ---------------------------------------------------------------------------
// Chainable<A, B>: compile-time proof that B's hardRequired is covered by A's produces
// ---------------------------------------------------------------------------

// Typed-contract nodes for Chainable demonstration (as const literal tuples).
class ChainFetchNode extends ScalarNode<ColocatedState, 'success'> {
  readonly name    = 'fetch';
  readonly outputs = ['success'] as const;
  override readonly contract: { hardRequired: ['url']; produces: ['raw'] } = {
    hardRequired: ['url'],
    produces:     ['raw'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

class ChainParseNode extends ScalarNode<ColocatedState, 'success'> {
  readonly name    = 'parse';
  readonly outputs = ['success'] as const;
  override readonly contract: { hardRequired: ['raw']; produces: ['record'] } = {
    hardRequired: ['raw'],
    produces:     ['record'],
  };
  protected override async executeOne() { return NodeOutputBuilder.of('success'); }
}

// #region chainable
// Chainable<A, B> resolves to `true` when B's hardRequired is fully satisfied
// by A's produces; `never` otherwise. Catches contract drift at compile time.
const chainFetch = new ChainFetchNode();
const chainParse = new ChainParseNode();

// Compiles: 'raw' in chainFetch.produces satisfies chainParse.hardRequired.
type FetchThenParse = Chainable<typeof chainFetch, typeof chainParse>;   // true

// Would not compile: chainParse.produces is ['record'], not ['raw'].
// type BackwardChain = Chainable<typeof chainParse, typeof chainFetch>; // never

void chainFetch;
void chainParse;
// The type-only assertion is compile-time only; no runtime assertion needed.
const _chainProof: FetchThenParse = true;
void _chainProof;
// #endregion chainable

// ---------------------------------------------------------------------------
// onContractWarning: subclass Dagonizer to surface dead-write warnings
// ---------------------------------------------------------------------------

// #region contract-warning
// Subclass Dagonizer and override onContractWarning to surface dead-write
// warnings. Called when a node produces a path no downstream node hardRequires.
// Dead writes are non-fatal; the DAG registers and executes normally.
class ObservingDispatcher extends Dagonizer<ColocatedState> {
  protected override onContractWarning(message: string): void {
    process.stderr.write(`[contract] ${message}\n`);
  }
}

const observingDispatcher = new ObservingDispatcher();
void observingDispatcher;
// #endregion contract-warning
