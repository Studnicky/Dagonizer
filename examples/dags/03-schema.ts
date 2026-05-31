/**
 * 03-schema/dags: pure module — DAG-literal JSON string, load, and echo node.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/03-schema.ts (the executable entry point).
 */

import {
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export const echo: NodeInterface<NodeStateBase, 'success'> = {
  'name': 'echo',
  'outputs': ['success'],
  async execute(state) {
    state.setMetadata('seen', true);
    return { 'output': 'success' };
  },
};

// ---------------------------------------------------------------------------
// Canonical JSON-LD DAG as a JSON string (the wire format).
//
// Note the required JSON-LD fields:
//   '@context': the DAG_CONTEXT object (serialised as an inline object)
//   '@id':      a URN uniquely identifying this DAG document
//   '@type':    must be the string literal 'DAG'
//
// Node placements use '@type' as the discriminator instead of a flat 'type'
// key. '@id' on each node is a scoped URN: <dagId>/node/<placementName>.
// ---------------------------------------------------------------------------

// #region dag-literal
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
    'body':        { '@id': 'https://noocodex.dev/ontology/dag/body' },
    'source':      { '@id': 'https://noocodex.dev/ontology/dag/source' },
    'itemKey':     { '@id': 'https://noocodex.dev/ontology/dag/itemKey' },
    'concurrency': { '@id': 'https://noocodex.dev/ontology/dag/concurrency' },
    'projection':  { '@id': 'https://noocodex.dev/ontology/dag/projection' },
    'gather':      { '@id': 'https://noocodex.dev/ontology/dag/gather' },
    'reducer':     { '@id': 'https://noocodex.dev/ontology/dag/reducer' },
    'outcome':     { '@id': 'https://noocodex.dev/ontology/dag/outcome' },
    'DAG':         { '@id': 'https://noocodex.dev/ontology/dag/DAG' },
    'Placement':   { '@id': 'https://noocodex.dev/ontology/dag/Placement' },
    'SingleNode':  { '@id': 'https://noocodex.dev/ontology/dag/SingleNode' },
    'TerminalNode': { '@id': 'https://noocodex.dev/ontology/dag/TerminalNode' },
    'ScatterNode': { '@id': 'https://noocodex.dev/ontology/dag/ScatterNode' },
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
// Load + export: Dagonizer.load() is the only valid ingest path
// ---------------------------------------------------------------------------

// #region load
// Dagonizer.load() throws ValidationError if JSON is malformed or schema fails.
export const dag = Dagonizer.load(dagJson);
// #endregion load
