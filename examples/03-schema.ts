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

import * as fs from 'node:fs/promises';
import {
  Dagonizer,
  NodeStateBase,
  ValidationError,
} from '@studnicky/dagonizer';
import { DAGDocument } from '@studnicky/dagonizer/dag';
import { DAGSchema } from '@studnicky/dagonizer/entities';
import { Validator } from '@studnicky/dagonizer/validation';
import { EchoNode, dag } from './dags/03-schema.js';

process.stdout.write(`\nLoaded:  ${dag.name} v${dag.version} (${dag.nodes.length} node(s))\n`);

// ── Execute ──────────────────────────────────────────────────────────────
// #region load-and-register
// DAGDocument.load() is the single ingest boundary: parse JSON, validate schema,
// return a fully-typed DAG or throw ValidationError.
const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(new EchoNode());
dispatcher.registerDAG(dag);

const state = new NodeStateBase();
await dispatcher.execute('from-json', state);
// #endregion load-and-register
process.stdout.write(`Executed: metadata.seen = ${String(state.getMetadata('seen'))}\n`);

// ── ofValue: validate an already-parsed object (skips JSON.parse) ──────
// #region from-value
// DAGDocument.ofValue() validates an already-parsed value — useful when a
// YAML parser, database query, or message queue provides a plain object.
const reparsed = DAGDocument.ofValue(JSON.parse(DAGDocument.serialize(dag)));
process.stdout.write(`ofValue name: ${reparsed.name}\n`);
// #endregion from-value

// ── DAGSchema.$id ─────────────────────────────────────────────────────────
// #region schema-id
process.stdout.write(`DAGSchema.$id: ${DAGSchema.$id}\n`);
// → 'https://noocodex.dev/schemas/dagonizer/DAG'
// #endregion schema-id

// ── Validator.dag ─────────────────────────────────────────────────────────
// #region validator-validate
// Validator.dag.validate() returns a narrowed DAG or throws ValidationError.
// This is the lower-level call that DAGDocument.load and registerDAG use.
const validated = Validator.dag.validate(JSON.parse(DAGDocument.serialize(dag)));
process.stdout.write(`Validator.dag.validate @type: ${validated['@type']}\n`);
// #endregion validator-validate

// ── Validator methods: is / validate / errors ─────────────────────────────
// #region validator-methods
// Each sub-validator exposes three methods:
const unknownValue: unknown = JSON.parse(DAGDocument.serialize(dag));
const isValid  = Validator.dag.is(unknownValue);          // type predicate → boolean
const dagAgain = Validator.dag.validate(unknownValue);    // returns DAG or throws
const errs     = Validator.dag.errors(unknownValue);      // string[] | null (null = valid)
process.stdout.write(`is: ${String(isValid)}, errors: ${String(errs)}, name: ${dagAgain.name}\n`);
// #endregion validator-methods

// ── Validator.terminalNode ────────────────────────────────────────────────
// #region validator-terminal
// Every top-level entity schema has a corresponding sub-validator on Validator.
const terminalValue: unknown = dag.nodes[1]; // TerminalNode placement from dag-literal
const isTerminal = Validator.terminalNode.is(terminalValue);
process.stdout.write(`is TerminalNode: ${String(isTerminal)}\n`);
// #endregion validator-terminal

// ── Round-trip: serialize → load → equivalent object ─────────────────────
// #region serialize-roundtrip
// DAGDocument.serialize(dag) produces pretty-printed JSON (2-space indent).
// DAGDocument.load(json) parses and validates it back to a typed DAG.
// The result is structurally identical to the original.
const serialized    = DAGDocument.serialize(dag);
const roundTripped  = DAGDocument.load(serialized);
const isEqual       = JSON.stringify(roundTripped) === JSON.stringify(dag);
process.stdout.write(`Round-trip equal: ${String(isEqual)}\n`);
// #endregion serialize-roundtrip

// ── Serialize to file and compact ─────────────────────────────────────────
// #region serialize-file
// DAGDocument.serialize() writes pretty JSON; pair with node:fs for persistence.
const json = DAGDocument.serialize(dag);
await fs.writeFile('/tmp/dag-03-example.json', json);
const loaded = DAGDocument.load(await fs.readFile('/tmp/dag-03-example.json', 'utf8'));
process.stdout.write(`Loaded from file: ${loaded.name}\n`);
// #endregion serialize-file

// #region serialize-compact
// DAGDocument.serializeCompact() produces single-line JSON — suitable for
// HTTP response bodies (content-type: application/ld+json) or message envelopes.
const compact = DAGDocument.serializeCompact(dag);
process.stdout.write(`compact length: ${String(compact.length)} (no whitespace)\n`);
// #endregion serialize-compact

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

// #region validation-error
// ValidationError exposes a machine-readable code and a human-readable message.
try {
  DAGDocument.load('{ "name": "broken" }');
} catch (error) {
  if (error instanceof ValidationError) {
    process.stdout.write(`code: ${error.code}\n`);       // 'VALIDATION_ERROR'
    process.stdout.write(`message: ${error.message.split('\n')[0]}\n`);
  }
}
// #endregion validation-error

process.stdout.write('\nLesson: DAGDocument.load() is the single ingest boundary;\n');
process.stdout.write('        serialize() + load() is a lossless round-trip.\n');
process.stdout.write('        Missing JSON-LD fields produce itemised ValidationError.\n');
