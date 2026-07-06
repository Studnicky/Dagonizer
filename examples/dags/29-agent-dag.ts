/**
 * 29-agent-dag/dags: JSON-LD canonical 8-node agent loop.
 *
 * The exported `dag` is the authored DAG document. Runnable examples provide
 * the concrete node instances separately and register this topology by name.
 */

import { DAG_CONTEXT } from '@studnicky/dagonizer';
import type { DAGType } from '@studnicky/dagonizer';

export const dag = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:my-agent',
  '@type': 'DAG',
  'name': 'my-agent',
  'version': '1',
  'entrypoint': 'build-request',
  'nodes': [
    {
      '@id': 'urn:noocodex:dag:my-agent/node/build-request',
      '@type': 'SingleNode',
      'name': 'build-request',
      'node': 'build-request',
      'outputs': {
        'ready': 'call-model',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/call-model',
      '@type': 'SingleNode',
      'name': 'call-model',
      'node': 'call-model',
      'outputs': {
        'text': 'normalize-response',
        'tools': 'normalize-response',
        'mixed': 'normalize-response',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/normalize-response',
      '@type': 'SingleNode',
      'name': 'normalize-response',
      'node': 'normalize-response',
      'outputs': {
        'text': 'append-assistant',
        'tools': 'decode-tools',
        'mixed': 'decode-tools',
        'empty': 'end-error',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/append-assistant',
      '@type': 'SingleNode',
      'name': 'append-assistant',
      'node': 'append-assistant',
      'outputs': {
        'done': 'end-done',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/decode-tools',
      '@type': 'SingleNode',
      'name': 'decode-tools',
      'node': 'decode-tools',
      'outputs': {
        'decoded': 'normalize-tools',
        'empty': 'end-error',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/normalize-tools',
      '@type': 'SingleNode',
      'name': 'normalize-tools',
      'node': 'normalize-tools',
      'outputs': {
        'valid': 'worksets',
        'empty': 'end-error',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/worksets',
      '@type': 'SingleNode',
      'name': 'worksets',
      'node': 'build-worksets',
      'outputs': {
        'ready': 'dispatch-tools',
        'empty': 'end-error',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/dispatch-tools',
      '@type': 'ScatterNode',
      'name': 'dispatch-tools',
      'source': 'safeWorkset',
      'body': { 'dagFrom': 'dagName' },
      'gather': {
        'strategy': 'map',
        'mapping': { 'output': 'toolOutputs' },
      },
      'outputs': {
        'all-success': 'collect-results',
        'partial': 'collect-results',
        'all-error': 'collect-results',
        'empty': 'collect-results',
      },
      'itemKey': 'currentItem',
      'reducer': 'aggregate',
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/collect-results',
      '@type': 'SingleNode',
      'name': 'collect-results',
      'node': 'collect-results',
      'outputs': {
        'done': 'build-request',
        'empty': 'build-request',
        'error': 'end-error',
      },
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/end-done',
      '@type': 'TerminalNode',
      'name': 'end-done',
      'outcome': 'completed',
    },
    {
      '@id': 'urn:noocodex:dag:my-agent/node/end-error',
      '@type': 'TerminalNode',
      'name': 'end-error',
      'outcome': 'failed',
    },
  ],
} satisfies DAGType;
