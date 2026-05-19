/**
 * derive — FlowDeriver: contract-derived flows with sub-DAG composition.
 *
 * Demonstrates the declarative authoring path: each operation declares
 * what it `produces` and `hardRequired`s, plus the output ports it can
 * emit. FlowDeriver matches produces ↔ hardRequired to derive the
 * edge set; every port auto-wires to the next derived stage.
 *
 * The `subDAGs` annotation swaps an operation's rendered placement
 * from SingleNode to DeepDAGNode without changing how the topology is
 * derived — the contract still participates in data-graph matching.
 *
 *   parent: prepare → invoke-plugin (sub-DAG) → finalize
 *   child:  validate → transform
 *
 * Run: npx tsx examples/derive.ts
 */

import type { OperationContract } from '../src/contracts/OperationContract.js';
import { FlowDeriver } from '../src/derive/FlowDeriver.js';
import {
  Dagonizer,
  NodeStateBase,
} from '../src/index.js';
import type { NodeInterface } from '../src/index.js';

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
  // The deep-DAG step itself just delegates — the dispatcher routes
  // through the registered child DAG. This node's `execute` runs as
  // the "wrapper" that the engine invokes; its outputs match the
  // declared subDAG.outputs.
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

const parentContracts: readonly OperationContract[] = [
  { "name": 'prepare',       "hardRequired": ['input'],        "produces": ['intermediate'], "outputs": ['success'] },
  { "name": 'invoke-plugin', "hardRequired": ['intermediate'], "produces": ['childResult'],  "outputs": ['success', 'error'] },
  { "name": 'finalize',      "hardRequired": ['childResult'],  "produces": ['final'],        "outputs": ['success'] },
];

const childContracts: readonly OperationContract[] = [
  { "name": 'validate',  "hardRequired": ['intermediate'], "produces": ['validated'],   "outputs": ['success', 'error'] },
  { "name": 'transform', "hardRequired": ['validated'],    "produces": ['childResult'], "outputs": ['success'] },
];

// ---------------------------------------------------------------------------
// Derive the DAGs
// ---------------------------------------------------------------------------

// Child DAG — simple validate→transform chain. validate's error port
// is terminated via `terminals`; the validator is a hard gate.
const childDAG = FlowDeriver.derive({
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

// Parent DAG — invoke-plugin runs the child DAG as a DeepDAGNode via
// the subDAGs annotation. Both `success` and `error` ports auto-wire
// to `finalize` (the next derived stage); finalize handles both
// paths uniformly. Per-port terminal overrides would route the
// error port elsewhere if needed.
const parentDAG = FlowDeriver.derive({
  "name":       'parent',
  "version":    '1.0',
  "entrypoint": 'prepare',
  "contracts":  parentContracts,
  "annotations": {
    "subDAGs": {
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
});

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
