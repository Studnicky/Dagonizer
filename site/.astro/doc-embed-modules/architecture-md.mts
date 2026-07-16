import { DAG_CONTEXT } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

// Sample three-node DAG used to illustrate output routing.
// validate → enrich → save, with explicit terminal routes.
const sampleDAG: DAGType = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodec:dag:sample',
  '@type': 'DAG',
  name: 'sample',
  version: '1',
  entrypoints: { main: 'urn:noocodec:dag:sample/node/validate' },
  nodes: [
    {
      '@id': 'urn:noocodec:dag:sample/node/validate',
      '@type': 'SingleNode',
      name: 'validate',
      node: 'validate',
      outputs: { valid: 'urn:noocodec:dag:sample/node/enrich', invalid: 'urn:noocodec:dag:sample/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:sample/node/enrich',
      '@type': 'SingleNode',
      name: 'enrich',
      node: 'enrich',
      outputs: { success: 'urn:noocodec:dag:sample/node/save', error: 'urn:noocodec:dag:sample/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:sample/node/save',
      '@type': 'SingleNode',
      name: 'save',
      node: 'save',
      outputs: { success: 'urn:noocodec:dag:sample/node/end', error: 'urn:noocodec:dag:sample/node/end' },
    },
    {
      '@id': 'urn:noocodec:dag:sample/node/end',
      '@type': 'TerminalNode',
      name: 'end',
      outcome: 'completed',
    },
  ],
};
export { sampleDAG };
