/**
 * 03-schema: JSON-LD DAG load from JSON string, validate, round-trip.
 *
 * Demonstrates the ingest boundary: `DAGDocument.load(json)` is the single
 * point where `unknown` enters the engine. It parses JSON, runs the Ajv
 * validator against DAGSchema, and returns a typed `DAG` or throws a
 * `ValidationError` listing every schema failure.
 *
 * Also shows the round-trip: `DAGDocument.serialize(dag)` produces the JSON
 * string that `DAGDocument.load()` can parse back to an equivalent object.
 *
 * Watch: the canonical JSON-LD shape (with '@context', '@id', '@type') is
 * required by the schema. A document missing these fields produces a
 * ValidationError with an itemised Ajv failure list.
 *
 * DAG definition (dag-literal JSON, load, echo node): examples/dags/03-schema.ts
 *
 * Run: npx tsx examples/03-schema.ts
 */

import {
  Dagonizer,
  NodeStateBase,
  ValidationError,
} from '@noocodex/dagonizer';
import { DAGDocument } from '@noocodex/dagonizer/entities';
import { EchoNode, dag } from './dags/03-schema.js';

process.stdout.write(`\nLoaded:  ${dag.name} v${dag.version} (${dag.nodes.length} node(s))\n`);

// ── Execute ──────────────────────────────────────────────────────────────
const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(new EchoNode());
dispatcher.registerDAG(dag);

const state = new NodeStateBase();
await dispatcher.execute('from-json', state);
process.stdout.write(`Executed: metadata.seen = ${String(state.getMetadata('seen'))}\n`);

// ── Round-trip: serialize → load → equivalent object ─────────────────────
// serialize() produces pretty JSON (2-space indent). The result is a valid
// string that load() can parse back without loss.
const serialized    = DAGDocument.serialize(dag);
const roundTripped  = DAGDocument.load(serialized);
const isEqual       = JSON.stringify(roundTripped) === JSON.stringify(dag);
process.stdout.write(`Round-trip equal: ${String(isEqual)}\n`);

// ── ValidationError: schema rejects any document missing required JSON-LD fields
// #region validate
try {
  // Missing '@context', '@id', '@type', 'entrypoint', 'nodes': schema rejects it.
  DAGDocument.load(JSON.stringify({ "name": 'broken', "version": '1' }));
} catch (error) {
  if (error instanceof ValidationError) {
    const firstLine = error.message.split('\n')[0];
    process.stdout.write(`ValidationError (first failure): ${firstLine}\n`);
  }
}
// #endregion validate

process.stdout.write('\nLesson: DAGDocument.load() is the single ingest boundary;\n');
process.stdout.write('        serialize() + load() is a lossless round-trip.\n');
process.stdout.write('        Missing JSON-LD fields produce itemised ValidationError.\n');
