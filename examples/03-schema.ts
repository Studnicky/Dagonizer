/**
 * 03-schema — JSON-LD DAG: load from JSON string, validate, round-trip.
 *
 * Demonstrates the ingest boundary: `Dagonizer.load(json)` is the single
 * point where `unknown` enters the engine. It parses JSON, runs the Ajv
 * validator against DAGSchema, and returns a typed `DAG` or throws a
 * `ValidationError` listing every schema failure.
 *
 * Also shows the round-trip: `Dagonizer.serialize(dag)` produces the JSON
 * string that `Dagonizer.load()` can parse back to an equivalent object.
 *
 * Watch: the canonical JSON-LD shape (with '@context', '@id', '@type') is
 * required by the schema. A document missing these fields produces a
 * ValidationError with an itemised Ajv failure list.
 *
 * Run: npx tsx examples/03-schema.ts
 */

import {
  Dagonizer,
  NodeStateBase,
  ValidationError,
} from '../src/index.js';
import type { NodeInterface } from '../src/index.js';

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

const echo: NodeInterface<NodeStateBase, 'success'> = {
  'name': 'echo',
  'outputs': ['success'],
  async execute(state) {
    state.setMetadata('seen', true);
    return { 'output': 'success' };
  },
};

// ---------------------------------------------------------------------------
// Canonical JSON-LD DAG as a JSON string — the wire format.
//
// Note the required JSON-LD fields:
//   '@context' — the DAG_CONTEXT object (serialised as an inline object)
//   '@id'      — a URN uniquely identifying this DAG document
//   '@type'    — must be the string literal 'DAG'
//
// Node placements use '@type' as the discriminator instead of a flat 'type'
// key. '@id' on each node is a scoped URN: <dagId>/node/<placementName>.
// ---------------------------------------------------------------------------

const dagJson = JSON.stringify({
  '@context': {
    '@version': 1.1,
    'name':        { '@id': 'https://noocodex.dev/ontology/dag/name' },
    'version':     { '@id': 'https://noocodex.dev/ontology/dag/version' },
    'entrypoint':  { '@id': 'https://noocodex.dev/ontology/dag/entrypoint' },
    'nodes':       { '@id': 'https://noocodex.dev/ontology/dag/nodes', '@container': '@set' },
    'outputs':     { '@id': 'https://noocodex.dev/ontology/dag/outputs' },
    'node':        { '@id': 'https://noocodex.dev/ontology/dag/node' },
    'dag':         { '@id': 'https://noocodex.dev/ontology/dag/dag' },
    'combine':     { '@id': 'https://noocodex.dev/ontology/dag/combine' },
    'source':      { '@id': 'https://noocodex.dev/ontology/dag/source' },
    'itemKey':     { '@id': 'https://noocodex.dev/ontology/dag/itemKey' },
    'concurrency': { '@id': 'https://noocodex.dev/ontology/dag/concurrency' },
    'fanIn':       { '@id': 'https://noocodex.dev/ontology/dag/fanIn' },
    'stateMapping':{ '@id': 'https://noocodex.dev/ontology/dag/stateMapping' },
    'DAG':         { '@id': 'https://noocodex.dev/ontology/dag/DAG' },
    'Placement':   { '@id': 'https://noocodex.dev/ontology/dag/Placement' },
    'SingleNode':  { '@id': 'https://noocodex.dev/ontology/dag/SingleNode' },
    'FanOutNode':  { '@id': 'https://noocodex.dev/ontology/dag/FanOutNode' },
    'DeepDAGNode': { '@id': 'https://noocodex.dev/ontology/dag/DeepDAGNode' },
    'ParallelNode': {
      '@id': 'https://noocodex.dev/ontology/dag/ParallelNode',
      '@context': { 'nodes': { '@id': 'https://noocodex.dev/ontology/dag/parallelNodes', '@container': '@list' } },
    },
  },
  '@id':        'urn:noocodex:dag:from-json',
  '@type':      'DAG',
  'name':       'from-json',
  'version':    '1',
  'entrypoint': 'echo',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:from-json/node/echo',
      '@type':   'SingleNode',
      'name':    'echo',
      'node':    'echo',
      'outputs': { 'success': null },
    },
  ],
});

// ---------------------------------------------------------------------------
// Load + validate — Dagonizer.load() is the only valid ingest path
// ---------------------------------------------------------------------------

// Dagonizer.load() throws ValidationError if JSON is malformed or schema fails.
const dag = Dagonizer.load(dagJson);
process.stdout.write(`\nLoaded:  ${dag.name} v${dag.version} (${dag.nodes.length} node(s))\n`);

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(echo);
dispatcher.registerDAG(dag);

const state = new NodeStateBase();
await dispatcher.execute('from-json', state);
process.stdout.write(`Executed: metadata.seen = ${String(state.getMetadata('seen'))}\n`);

// ---------------------------------------------------------------------------
// Round-trip: serialize → load → equivalent object
// ---------------------------------------------------------------------------

// serialize() produces pretty JSON (2-space indent). The result is a valid
// string that load() can parse back without loss.
const serialized    = Dagonizer.serialize(dag);
const roundTripped  = Dagonizer.load(serialized);
const isEqual       = JSON.stringify(roundTripped) === JSON.stringify(dag);
process.stdout.write(`Round-trip equal: ${String(isEqual)}\n`);

// ---------------------------------------------------------------------------
// ValidationError — schema rejects any document missing required JSON-LD fields
// ---------------------------------------------------------------------------

try {
  // Missing '@context', '@id', '@type', 'entrypoint', 'nodes' — schema rejects it.
  Dagonizer.load(JSON.stringify({ "name": 'broken', "version": '1' }));
} catch (error) {
  if (error instanceof ValidationError) {
    const firstLine = error.message.split('\n')[0];
    process.stdout.write(`ValidationError (first failure): ${firstLine}\n`);
  }
}

process.stdout.write('\nLesson: Dagonizer.load() is the single ingest boundary;\n');
process.stdout.write('        serialize() + load() is a lossless round-trip.\n');
process.stdout.write('        Missing JSON-LD fields produce itemised ValidationError.\n');
