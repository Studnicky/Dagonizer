/**
 * derive: DAGDeriver for declarative authoring of agentic flows.
 *
 * Use this surface when the operation set IS the spec; adding a tool
 * should auto-rewire the flow. Each operation declares what it needs
 * (`hardRequired`) and what it produces (`produces`); DAGDeriver
 * matches produces ↔ hardRequired to derive the topology. Every port
 * in `outputs` auto-wires to the next derived stage; annotations
 * override individual ports and swap placement kinds at render time.
 *
 * This example demonstrates agentic tool dispatch: a parent flow
 * delegates the actual work to a registered sub-DAG via the `embeddedDAGs`
 * annotation, which the deriver renders as an EmbeddedDAGNode whose `dag`
 * runs the child DAG. Plug in a different child DAG (different "tool") at
 * registration time without rewriting the parent.
 *
 *   parent: prepare → invoke-plugin (EmbeddedDAGNode → child DAG) → finalize
 *   child:  validate → transform
 *
 * DAG definition (state, nodes, derived dags): examples/dags/derive.ts
 *
 * Run: npx tsx examples/derive.ts
 *
 * Companion: examples/02-builder.ts demonstrates the deterministic /
 * ETL authoring path via DAGBuilder. Same canonical DAG output; pick
 * the path that matches your mental model.
 */

import { Dagonizer } from '@studnicky/dagonizer';
import {
  PipelineState,
  PrepareNode,
  InvokePluginNode,
  FinalizeNode,
  ValidateNode,
  TransformNode,
  childDAG,
  parentDAG,
} from './dags/derive.js';

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<PipelineState>();
dispatcher.registerNode(new PrepareNode());
dispatcher.registerNode(new InvokePluginNode());
dispatcher.registerNode(new FinalizeNode());
dispatcher.registerNode(new ValidateNode());
dispatcher.registerNode(new TransformNode());
dispatcher.registerDAG(childDAG);
dispatcher.registerDAG(parentDAG);

const state = new PipelineState();
state.input = 'hello';
const result = await dispatcher.execute('parent', state);

process.stdout.write(`derived parent DAG: ${parentDAG.nodes.map(n => `${n['@type']}(${n.name})`).join(' → ')}\n`);
process.stdout.write(`derived child  DAG: ${childDAG.nodes.map(n => `${n['@type']}(${n.name})`).join(' → ')}\n`);
process.stdout.write(`lifecycle:  ${result.state.lifecycle.variant}\n`);
process.stdout.write(`final:      ${result.state.final}\n`);
process.stdout.write(`executed:   ${result.executedNodes.join(' → ')}\n`);
