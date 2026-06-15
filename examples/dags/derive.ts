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
import { NodeOutputBuilder, NodeStateBase, ScalarNode } from '@noocodex/dagonizer';
import type { OperationContractFragment } from '@noocodex/dagonizer/contracts';

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
