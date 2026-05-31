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
import { NodeStateBase } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class S extends NodeStateBase {
  input        = '';
  intermediate = '';
  childResult  = '';
  final        = '';
}

// ---------------------------------------------------------------------------
// Nodes: same NodeInterface shape regardless of authoring path
// ---------------------------------------------------------------------------

export const prepare: NodeInterface<S, 'success'> = {
  "name": 'prepare',
  "outputs": ['success'],
  "contract": { "hardRequired": ['input'], "produces": ['intermediate'] },
  async execute(state) {
    state.intermediate = state.input.toUpperCase();
    return { "output": 'success' };
  },
};

export const validate: NodeInterface<S, 'success' | 'error'> = {
  "name": 'validate',
  "outputs": ['success', 'error'],
  "contract": { "hardRequired": ['intermediate'], "produces": ['validated'] },
  async execute(state) {
    if (state.intermediate.length === 0) return { "output": 'error' };
    return { "output": 'success' };
  },
};

export const transform: NodeInterface<S, 'success'> = {
  "name": 'transform',
  "outputs": ['success'],
  "contract": { "hardRequired": ['validated'], "produces": ['childResult'] },
  async execute(state) {
    state.childResult = `[${state.intermediate}]`;
    return { "output": 'success' };
  },
};

export const invokePlugin: NodeInterface<S, 'success' | 'error'> = {
  // invoke-plugin carries the contract (hardRequired/produces) the deriver
  // uses to place this stage in the topology. The embeddedDAGs annotation
  // renders it as an EmbeddedDAGNode whose `dag` runs the child DAG;
  // so this `execute` does not run; the sub-DAG does the work.
  // Its `outputs` declare the ports the EmbeddedDAGNode routes on.
  "name": 'invoke-plugin',
  "outputs": ['success', 'error'],
  "contract": { "hardRequired": ['intermediate'], "produces": ['childResult'] },
  async execute() {
    return { "output": 'success' };
  },
};

export const finalize: NodeInterface<S, 'success'> = {
  "name": 'finalize',
  "outputs": ['success'],
  "contract": { "hardRequired": ['childResult'], "produces": ['final'] },
  async execute(state) {
    state.final = `done: ${state.childResult}`;
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// Derive the DAGs
// ---------------------------------------------------------------------------

// #region derive
// Child DAG: simple validate->transform chain. validate's error port
// is terminated via `terminals`; the validator is a hard gate.
// #region contracts
export const childDAG = DAGDeriver.derive({
  "name":       'plugin:transform',
  "version":    '1.0',
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
  "version":    '1.0',
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
