/**
 * 07-schema — load a DAG from a JSON string, validate against
 * `DAGSchema`, then execute.
 *
 * The runtime validator catches malformed JSON at the ingest boundary
 * before any semantic checks. ValidationError carries every Ajv failure as
 * a formatted `<instancePath>: <message>` line.
 *
 * Run: npx tsx examples/07-schema.ts
 */

import {
  NodeStateBase,
  Dagonizer,
  ValidationError,
} from '../src/index.js';
import type { NodeInterface } from '../src/index.js';

const echo: NodeInterface<NodeStateBase, 'success'> = {
  "name": 'echo',
  "outputs": ['success'],
  async execute(state) {
    state.setMetadata('seen', true);
    return { "output": 'success' };
  },
};

const dagJson = `{
  "name": "from-json",
  "version": "1",
  "entrypoint": "echo",
  "nodes": [
    { "type": "single", "name": "echo", "node": "echo", "outputs": { "success": null } }
  ]
}`;

const dag = Dagonizer.load(dagJson);
process.stdout.write(`loaded: ${dag.name} v${dag.version}\n`);

const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(echo);
dispatcher.registerDAG(dag);

const state = new NodeStateBase();
await dispatcher.execute('from-json', state);
process.stdout.write(`ran DAG; seen = ${String(state.getMetadata('seen'))}\n`);

// Round-trip: serialize → load yields an equivalent DAG.
const roundTripped = Dagonizer.load(Dagonizer.serialize(dag));
process.stdout.write(`round-trip equal: ${String(JSON.stringify(roundTripped) === JSON.stringify(dag))}\n`);

// Malformed input is rejected with a ValidationError listing each Ajv failure.
try {
  Dagonizer.load('{ "name": "broken" }');
} catch (error) {
  if (error instanceof ValidationError) {
    process.stdout.write(`validation error path works: ${error.message.split('\n')[0]}\n`);
  }
}
