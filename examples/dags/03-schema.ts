/**
 * 03-schema/dags: pure module — DAG-literal JSON string, load, and echo node.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/03-schema.ts (the executable entry point).
 */

import {
  Batch,
  DAG_CONTEXT,
  MonadicNode,
  NodeOutput,
  NodeStateBase,
  RoutedBatch,
} from '@studnicky/dagonizer';
import { DAGDocument } from '@studnicky/dagonizer/dag';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class EchoNode extends MonadicNode<NodeStateBase, 'success'> {
  readonly name = 'echo';
  readonly '@id' = 'urn:noocodec:node:echo';
  readonly outputs = ['success'] as const;
  override get outputSchema(): Record<'success', SchemaObjectType> {
    return { 'success': { 'type': 'object' } };
  }

  override async execute(batch: Batch<NodeStateBase>) {
    for (const item of batch) {
      item.state.setMetadata('seen', true);
    }
    return RoutedBatch.create(NodeOutput.create('success').output, batch);
  }
}

// ---------------------------------------------------------------------------
// Canonical JSON-LD DAG as a JSON string (the wire format).
//
// Note the required JSON-LD fields:
//   '@context': the DAG_CONTEXT constant (imported from '@studnicky/dagonizer')
//   '@id':      a URN uniquely identifying this DAG document
//   '@type':    must be the string literal 'DAG'
//
// Node placements use '@type' as the discriminator instead of a flat 'type'
// key. Every placement declares its own absolute '@id'; name is only a display label.
// ---------------------------------------------------------------------------

// #region dag-literal
const dagJson = JSON.stringify({
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:from-json',
  '@type':      'DAG',
  'name':       'from-json',
  'version':    '1',
  'entrypoints': { 'main': 'urn:noocodec:dag:from-json/node/echo' },
  'nodes': [
    {
      '@id': 'urn:noocodec:dag:from-json/node/echo',
      '@type':   'SingleNode',
      'name':    'echo',
      'node':    'urn:noocodec:node:echo',
      'outputs': { 'success': 'urn:noocodec:dag:from-json/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:from-json/node/end',
      '@type':   'TerminalNode',
      'name':    'end',
      'outcome': 'completed',
    },
  ],
});
// #endregion dag-literal

// ---------------------------------------------------------------------------
// Load + export: DAGDocument.load() is the only valid ingest path
// ---------------------------------------------------------------------------

// #region load
// DAGDocument.load() throws DAGError (code VALIDATION_ERROR) if JSON is malformed or schema fails.
export const dag = DAGDocument.load(dagJson);
// #endregion load
