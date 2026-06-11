/**
 * 03-schema/dags: pure module — DAG-literal JSON string, load, and echo node.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/03-schema.ts (the executable entry point).
 */

import {
  DAG_CONTEXT,
  NodeOutputBuilder,
  NodeStateBase,
  EMPTY_CONTRACT_FRAGMENT,
  Timeout,
} from '@noocodex/dagonizer';
import { DAGDocument } from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class EchoNode implements NodeInterface<NodeStateBase, 'success'> {
  readonly contract = EMPTY_CONTRACT_FRAGMENT;
  readonly timeout = Timeout.none();
  readonly name = 'echo';
  readonly outputs = ['success'] as const;

  async execute(state: NodeStateBase) {
    state.setMetadata('seen', true);
    return NodeOutputBuilder.of('success');
  }
}

// ---------------------------------------------------------------------------
// Canonical JSON-LD DAG as a JSON string (the wire format).
//
// Note the required JSON-LD fields:
//   '@context': the DAG_CONTEXT constant (imported from '@noocodex/dagonizer')
//   '@id':      a URN uniquely identifying this DAG document
//   '@type':    must be the string literal 'DAG'
//
// Node placements use '@type' as the discriminator instead of a flat 'type'
// key. '@id' on each node is a scoped URN: <dagId>/node/<placementName>.
// ---------------------------------------------------------------------------

// #region dag-literal
const dagJson = JSON.stringify({
  '@context': DAG_CONTEXT,
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
      'outputs': { 'success': 'end' },
    },
    {
      '@id':     'urn:noocodex:dag:from-json/node/end',
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
// DAGDocument.load() throws ValidationError if JSON is malformed or schema fails.
export const dag = DAGDocument.load(dagJson);
// #endregion load
