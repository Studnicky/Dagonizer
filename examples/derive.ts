/**
 * derive — DAGDeriver: declarative authoring for agentic flows.
 *
 * Use this surface when the operation set IS the spec — adding a tool
 * should auto-rewire the flow. Each operation declares what it needs
 * (`hardRequired`) and what it produces (`produces`); DAGDeriver
 * matches produces ↔ hardRequired to derive the topology. Every port
 * in `outputs` auto-wires to the next derived stage; annotations
 * override individual ports and swap placement kinds at render time.
 *
 * This example demonstrates agentic tool dispatch: a parent flow
 * delegates the actual work to a registered sub-DAG via the `embeddedDAGs`
 * annotation, which the deriver renders as a ScatterNode singleton
 * (`body: { dag }`). Plug in a different child DAG (different "tool") at
 * registration time without rewriting the parent.
 *
 *   parent: prepare → invoke-plugin (ScatterNode → child DAG) → finalize
 *   child:  validate → transform
 *
 * Run: npx tsx examples/derive.ts
 *
 * Companion: examples/02-builder.ts demonstrates the deterministic /
 * ETL authoring path via DAGBuilder. Same canonical DAG output — pick
 * the journey that matches your mental model.
 */

import { DAGDeriver } from '@noocodex/dagonizer/derive';
import type { OperationContract } from '@noocodex/dagonizer/derive';
import {
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class S extends NodeStateBase {
  input        = '';
  intermediate = '';
  childResult  = '';
  final        = '';
}

// ---------------------------------------------------------------------------
// Nodes — same NodeInterface shape regardless of authoring path
// ---------------------------------------------------------------------------

const prepare: NodeInterface<S, 'success'> = {
  "name": 'prepare',
  "outputs": ['success'],
  async execute(state) {
    state.intermediate = state.input.toUpperCase();
    return { "output": 'success' };
  },
};

const validate: NodeInterface<S, 'success' | 'error'> = {
  "name": 'validate',
  "outputs": ['success', 'error'],
  async execute(state) {
    if (state.intermediate.length === 0) return { "output": 'error' };
    return { "output": 'success' };
  },
};

const transform: NodeInterface<S, 'success'> = {
  "name": 'transform',
  "outputs": ['success'],
  async execute(state) {
    state.childResult = `[${state.intermediate}]`;
    return { "output": 'success' };
  },
};

const invokePlugin: NodeInterface<S, 'success' | 'error'> = {
  // invoke-plugin carries the contract (hardRequired/produces) the deriver
  // uses to place this stage in the topology. The embeddedDAGs annotation
  // renders it as a ScatterNode whose `body: { dag }` runs the child DAG in
  // a clone — so this `execute` does not run; the sub-DAG does the work.
  // Its `outputs` declare the ports the ScatterNode routes on.
  "name": 'invoke-plugin',
  "outputs": ['success', 'error'],
  async execute() {
    return { "output": 'success' };
  },
};

const finalize: NodeInterface<S, 'success'> = {
  "name": 'finalize',
  "outputs": ['success'],
  async execute(state) {
    state.final = `done: ${state.childResult}`;
    return { "output": 'success' };
  },
};

// ---------------------------------------------------------------------------
// Contracts — produces ↔ hardRequired derives the topology
// ---------------------------------------------------------------------------

// #region contracts
const parentContracts: readonly OperationContract[] = [
  { "name": 'prepare',       "hardRequired": ['input'],        "produces": ['intermediate'], "outputs": ['success'] },
  { "name": 'invoke-plugin', "hardRequired": ['intermediate'], "produces": ['childResult'],  "outputs": ['success', 'error'] },
  { "name": 'finalize',      "hardRequired": ['childResult'],  "produces": ['final'],        "outputs": ['success'] },
];

const childContracts: readonly OperationContract[] = [
  { "name": 'validate',  "hardRequired": ['intermediate'], "produces": ['validated'],   "outputs": ['success', 'error'] },
  { "name": 'transform', "hardRequired": ['validated'],    "produces": ['childResult'], "outputs": ['success'] },
];
// #endregion contracts

// ---------------------------------------------------------------------------
// Derive the DAGs
// ---------------------------------------------------------------------------

// #region derive
// Child DAG — simple validate→transform chain. validate's error port
// is terminated via `terminals`; the validator is a hard gate.
const childDAG = DAGDeriver.derive({
  "name":       'plugin:transform',
  "version":    '1.0',
  "entrypoint": 'validate',
  "contracts":  childContracts,
  "annotations": {
    "terminals": {
      "validate": [{ "outcome": 'error', "target": null }],
    },
  },
});

// Parent DAG — invoke-plugin runs the child DAG via the embeddedDAGs
// annotation, which the deriver renders as a ScatterNode singleton
// (`body: { dag }`). stateMapping.input becomes the scatter's projection
// (parent → clone) and stateMapping.output becomes a `map` gather
// (clone → parent). Both `success` and `error` ports auto-wire to
// `finalize` (the next derived stage); finalize handles both paths
// uniformly. Per-port terminal overrides would route the error port
// elsewhere if needed.
const parentDAG = DAGDeriver.derive({
  "name":       'parent',
  "version":    '1.0',
  "entrypoint": 'prepare',
  "contracts":  parentContracts,
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
  },
  // #endregion annotations
});
// #endregion derive

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<S>();
dispatcher.registerNode(prepare);
dispatcher.registerNode(invokePlugin);
dispatcher.registerNode(finalize);
dispatcher.registerNode(validate);
dispatcher.registerNode(transform);
dispatcher.registerDAG(childDAG);
dispatcher.registerDAG(parentDAG);

const state = new S();
state.input = 'hello';
const result = await dispatcher.execute('parent', state);

process.stdout.write(`derived parent DAG: ${parentDAG.nodes.map(n => `${n['@type']}(${n.name})`).join(' → ')}\n`);
process.stdout.write(`derived child  DAG: ${childDAG.nodes.map(n => `${n['@type']}(${n.name})`).join(' → ')}\n`);
process.stdout.write(`lifecycle:  ${result.state.lifecycle.kind}\n`);
process.stdout.write(`final:      ${result.state.final}\n`);
process.stdout.write(`executed:   ${result.executedNodes.join(' → ')}\n`);
