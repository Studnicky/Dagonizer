/**
 * json-ld: DAGDocument round-trip and persistence patterns.
 *
 * Demonstrates the full JSON-LD lifecycle:
 *   1. Build a DAG via DAGBuilder
 *   2. Serialize to pretty JSON (DAGDocument.serialize)
 *   3. Serialize to compact JSON (DAGDocument.serializeCompact)
 *   4. Load back from a JSON string (DAGDocument.load)
 *   5. Validate an already-parsed value (DAGDocument.fromValue)
 *   6. Persistence: file on disk, simulated database row, HTTP compact wire
 *
 * The serialized document is a JSON-LD 1.1 document with @context, @id,
 * and @type. DAGDocument.load / DAGDocument.fromValue are the only valid
 * ingest boundaries; both validate against DAGSchema via Ajv 2020-12.
 *
 * Run: npx tsx examples/json-ld.ts
 */

import * as fs from 'node:fs/promises';
import {
  DAGBuilder,
  Dagonizer,
  NodeOutputBuilder,
  NodeStateBase,
  ScalarNode,
} from '@studnicky/dagonizer';
import { DAGDocument } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// Node: a minimal transform node for the demo DAG
// ---------------------------------------------------------------------------

class TransformNode extends ScalarNode<NodeStateBase, 'success'> {
  readonly name = 'transform';
  readonly outputs = ['success'] as const;

  protected override async executeOne(state: NodeStateBase) {
    state.setMetadata('transformed', true);
    return NodeOutputBuilder.of('success');
  }
}

// ---------------------------------------------------------------------------
// Round-trip: build → serialize → load
// ---------------------------------------------------------------------------

// #region round-trip
// Build a DAG via DAGBuilder — the canonical JSON-LD object.
const original = new DAGBuilder('demo', '1')
  .node('transform', new TransformNode(), { success: 'end' })
  .terminal('end')
  .build();

// Serialize to a pretty-printed JSON string (2-space indent).
const json = DAGDocument.serialize(original);

// Load back from the JSON string — validates against DAGSchema and returns
// a fully-typed DAG. Structure is identical to the original.
const reloaded = DAGDocument.load(json);

process.stdout.write(`@type:              ${reloaded['@type']}\n`);            // 'DAG'
process.stdout.write(`nodes[0] @type:     ${reloaded.nodes[0]?.['@type']}\n`); // 'SingleNode'
// #endregion round-trip

// ---------------------------------------------------------------------------
// fromValue: validate an already-parsed object (skips JSON.parse)
// ---------------------------------------------------------------------------

// #region from-value-round-trip
// DAGDocument.fromValue() is for callers that already decoded their input —
// a Postgres jsonb column, a YAML parser output, a decoded message envelope.
// It skips JSON.parse and runs only the schema validation.
const parsed: unknown = JSON.parse(json);
const fromValue = DAGDocument.fromValue(parsed);
process.stdout.write(`fromValue name: ${fromValue.name}\n`); // 'demo'
// #endregion from-value-round-trip

// ---------------------------------------------------------------------------
// Compact serialization
// ---------------------------------------------------------------------------

// #region serialize-compact
// DAGDocument.serializeCompact() produces single-line JSON with no whitespace.
// Use for HTTP response bodies (content-type: application/ld+json) or message
// envelopes where payload size matters.
const compact = DAGDocument.serializeCompact(original);
process.stdout.write(`compact starts with: ${compact.slice(0, 30)}...\n`);
// → '{"@context":{"@version":1.1,...'
// #endregion serialize-compact

// ---------------------------------------------------------------------------
// Persistence: file on disk
// ---------------------------------------------------------------------------

// #region persistence-file
// Write the pretty JSON to disk; read it back and re-validate at load time.
await fs.writeFile('/tmp/dag-json-ld.json', DAGDocument.serialize(original));
const loadedFromFile = DAGDocument.load(
  await fs.readFile('/tmp/dag-json-ld.json', 'utf8'),
);
process.stdout.write(`loaded from file: ${loadedFromFile.name}\n`); // 'demo'
// #endregion persistence-file

// ---------------------------------------------------------------------------
// Persistence: simulated database row (text / JSON column)
// ---------------------------------------------------------------------------

// #region persistence-db
// A database column (text or JSON) stores the serialized DAG body.
// On read, pass the column value through DAGDocument.load (text) or
// DAGDocument.fromValue (pre-parsed jsonb) to validate at the ingest boundary.
const store = new Map<string, string>();
store.set(original['@id'], DAGDocument.serialize(original));

const row    = store.get('urn:noocodex:dag:demo') ?? '';
const loadedFromDb = DAGDocument.load(row);
process.stdout.write(`loaded from db: ${loadedFromDb.name}\n`); // 'demo'
// #endregion persistence-db

// ---------------------------------------------------------------------------
// Execution: the loaded DAG is consumed directly by the dispatcher
// ---------------------------------------------------------------------------

// #region execute-loaded
// The loaded DAG is the same canonical object DAGBuilder.build() returns.
// Pass it directly to dispatcher.registerDAG() — no projection or adapter needed.
const dispatcher = new Dagonizer<NodeStateBase>();
dispatcher.registerNode(new TransformNode());
dispatcher.registerDAG(loadedFromFile);

const state = new NodeStateBase();
await dispatcher.execute('demo', state);
process.stdout.write(`transformed: ${String(state.getMetadata('transformed'))}\n`); // true
// #endregion execute-loaded

process.stdout.write('\nLesson: DAGDocument.serialize() + DAGDocument.load() is a lossless round-trip.\n');
process.stdout.write('        The serialized document is a JSON-LD 1.1 doc: @context, @id, @type.\n');
process.stdout.write('        DAGDocument.load / fromValue are the only valid ingest boundaries.\n');
