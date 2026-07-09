/**
 * 02-builder: DAGBuilder for deterministic authoring of ETL / control-flow chains.
 *
 * Use this surface when you know the sequence of steps end-to-end and want
 * the TypeScript compiler to verify every route is wired. Each `.node()` call
 * declares one placement and its routing map; the `routes` argument is narrowed
 * by the node's TOutput union, so misspelled or missing route keys are
 * compile errors before the DAG ever runs.
 *
 * DAGBuilder is the right tool for: ETL pipelines, transformation chains,
 * fixed user-onboarding flows, anywhere the order IS the spec.
 *
 * Watch: DAGBuilder.build() returns a fully-formed JSON-LD DAG including
 * '@context', '@id', and '@type'. The dispatcher consumes that document
 * directly.
 *
 * DAG definition (state, nodes, dag): examples/dags/02-builder.topology.ts
 *
 * Run: npx tsx examples/02-builder.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import { chatDAGIri as dagIri, dag, ChatState, ClassifyNode, RespondNode } from './dags/02-builder.topology.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// #region run
const dispatcher = new Dagonizer<ChatState>();
dispatcher.registerNode(new ClassifyNode());
dispatcher.registerNode(new RespondNode());
dispatcher.registerDAG(dag);  // same API as with a literal; build() returns a valid DAG

const state = new ChatState();
state.input = 'What is a generic type parameter?';
await dispatcher.execute(dagIri, state);

process.stdout.write('\nBuilder DAG: same shape as 01-linear, constructed via DAGBuilder (02-builder)\n');
process.stdout.write(`  input:  "${state.input}"\n`);
process.stdout.write(`  reply:  "${state.reply}"\n`);
process.stdout.write(`\n  built DAG @id: ${dag['@id']}\n`);
process.stdout.write(`  nodes:  ${dag.nodes.map(n => `${n['@type']}(${n.name})`).join(' → ')}\n`);
process.stdout.write('\nLesson: DAGBuilder.build() produces the canonical JSON-LD DAG document;\n');
process.stdout.write('        routes are exhaustiveness-checked.\n');
// #endregion run
