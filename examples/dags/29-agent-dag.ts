/**
 * 29-agent-dag/dags: explicit DAGBuilder 8-node agent loop.
 *
 * The exported `dag` is a JSON-LD document built from the same DAGBuilder
 * surface applications use for custom graph authoring. Runnable examples
 * provide concrete node instances with the same names and register this
 * topology by name.
 */

import { DAGBuilder, PlaceholderNode } from '@studnicky/dagonizer';
import type { DAGType, NodeStateInterface } from '@studnicky/dagonizer';

const topologyNodes = {
  'chatRequest':         new PlaceholderNode<NodeStateInterface, 'ready' | 'error'>('build-request', ['ready', 'error']),
  'callModel':           new PlaceholderNode<NodeStateInterface, 'text' | 'tools' | 'mixed' | 'error'>('call-model', ['text', 'tools', 'mixed', 'error']),
  'normalizeResponse':   new PlaceholderNode<NodeStateInterface, 'text' | 'tools' | 'mixed' | 'empty' | 'error'>('normalize-response', ['text', 'tools', 'mixed', 'empty', 'error']),
  'decodeTextToolCalls': new PlaceholderNode<NodeStateInterface, 'decoded' | 'empty' | 'error'>('decode-tools', ['decoded', 'empty', 'error']),
  'normalizeToolCalls':  new PlaceholderNode<NodeStateInterface, 'valid' | 'empty' | 'error'>('normalize-tools', ['valid', 'empty', 'error']),
  'toolWorksets':        new PlaceholderNode<NodeStateInterface, 'ready' | 'empty' | 'error'>('build-worksets', ['ready', 'empty', 'error']),
  'collectToolResults':  new PlaceholderNode<NodeStateInterface, 'done' | 'empty' | 'error'>('collect-results', ['done', 'empty', 'error']),
  'appendAssistant':     new PlaceholderNode<NodeStateInterface, 'done' | 'error'>('append-assistant', ['done', 'error']),
};

export const dag: DAGType = new DAGBuilder('my-agent', '1')
  .node('build-request', topologyNodes.chatRequest, {
    'ready': 'call-model',
    'error': 'end-error',
  })
  .node('call-model', topologyNodes.callModel, {
    'text':  'normalize-response',
    'tools': 'normalize-response',
    'mixed': 'normalize-response',
    'error': 'end-error',
  })
  .node('normalize-response', topologyNodes.normalizeResponse, {
    'text':  'append-assistant',
    'tools': 'decode-tools',
    'mixed': 'decode-tools',
    'empty': 'end-error',
    'error': 'end-error',
  })
  .node('append-assistant', topologyNodes.appendAssistant, {
    'done':  'end-done',
    'error': 'end-error',
  })
  .node('decode-tools', topologyNodes.decodeTextToolCalls, {
    'decoded': 'normalize-tools',
    'empty':   'end-error',
    'error':   'end-error',
  })
  .node('normalize-tools', topologyNodes.normalizeToolCalls, {
    'valid': 'worksets',
    'empty': 'end-error',
    'error': 'end-error',
  })
  .node('worksets', topologyNodes.toolWorksets, {
    'ready': 'dispatch-tools',
    'empty': 'end-error',
    'error': 'end-error',
  })
  .scatter(
    'dispatch-tools',
    'safeWorkset',
    { 'dag': { 'from': 'item', 'path': 'dagName', 'candidates': ['tool:calculator'] } },
    {
      'all-success': 'collect-results',
      'partial':     'collect-results',
      'all-error':   'collect-results',
      'empty':       'collect-results',
    },
    {
      'itemKey': 'currentItem',
      'gather': {
        'strategy': 'map',
        'mapping':  { 'output': 'toolOutputs' },
      },
    },
  )
  .node('collect-results', topologyNodes.collectToolResults, {
    'done':  'build-request',
    'empty': 'build-request',
    'error': 'end-error',
  })
  .terminal('end-done')
  .terminal('end-error', { 'outcome': 'failed' })
  .build();
