/**
 * json-ld: DAGDocument round-trip and persistence patterns.
 *
 * Demonstrates the full JSON-LD lifecycle:
 *   1. Build a DAG via DAGBuilder
 *   2. Serialize to JSON (DAGDocument.serialize)
 *   3. Load back from a JSON string (DAGDocument.load)
 *   4. Persistence: file on disk, simulated database row
 *
 * The serialized document is a JSON-LD 1.1 document with @context, @id,
 * and @type. DAGDocument.load is the only DAG document ingest boundary;
 * it validates against DAGSchema via Ajv 2020-12.
 *
 * Run: npx tsx examples/json-ld.ts
 */

import * as fs from 'node:fs/promises';
import {
  Batch,
  DAGBuilder,
  Dagonizer,
  DAGIdentity,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import { DAGDocument } from '@studnicky/dagonizer/dag';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// Node: a minimal transform node for the demo DAG
// ---------------------------------------------------------------------------

class TransformNode extends MonadicNode<NodeStateBase, 'success'> {
  readonly name = 'transform';
  readonly '@id' = 'urn:noocodec:node:transform';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<NodeStateBase>) {
    for (const item of batch) {
      item.state.setMetadata('transformed', true);
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Round-trip: build → serialize → load
// ---------------------------------------------------------------------------

// #region round-trip
// Build a DAG via DAGBuilder — the canonical JSON-LD object.
const dagIri = 'urn:noocodec:dag:demo' as const;
const placement = (placementIdentifier: string): string => DAGIdentity.placementId(dagIri, placementIdentifier);

const original = new DAGBuilder(dagIri, '1')
  .node(placement('transform'), new TransformNode(), { success: placement('end') })
  .terminal(placement('end'))
  .build();

// Serialize to JSON.
const json = DAGDocument.serialize(original);

// Load back from the JSON string — validates against DAGSchema and returns
// a fully-typed DAG. Structure is identical to the original.
const reloaded = DAGDocument.load(json);

process.stdout.write(`@type:              ${reloaded['@type']}\n`);            // 'DAG'
process.stdout.write(`nodes[0] @type:     ${reloaded.nodes[0]?.['@type']}\n`); // 'SingleNode'
// #endregion round-trip

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
// A database column stores the serialized DAG body. On read, pass the JSON
// string through DAGDocument.load to validate at the ingest boundary.
const store = new Map<string, string>();
store.set(original['@id'], DAGDocument.serialize(original));

const row = store.get('urn:noocodec:dag:demo') ?? '';
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
await dispatcher.execute(dagIri, state);
process.stdout.write(`transformed: ${String(state.getMetadata('transformed'))}\n`); // true
// #endregion execute-loaded

process.stdout.write('\nLesson: DAGDocument.serialize() + DAGDocument.load() is a lossless round-trip.\n');
process.stdout.write('        The serialized document is a JSON-LD 1.1 doc: @context, @id, @type.\n');
process.stdout.write('        DAGDocument.load is the only valid DAG document ingest boundary.\n');
