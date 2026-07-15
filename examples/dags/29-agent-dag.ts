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

export const dagIri = 'urn:noocodec:dag:my-agent' as const;
const placement = (placementIdentifier: string): string => `${dagIri}/node/${placementIdentifier}`;

const topologyNodes = {
  'chatRequest':         new PlaceholderNode<NodeStateInterface, 'ready' | 'error'>('urn:noocodec:node:build-request', ['ready', 'error']),
  'callModel':           new PlaceholderNode<NodeStateInterface, 'text' | 'tools' | 'mixed' | 'error'>('urn:noocodec:node:call-model', ['text', 'tools', 'mixed', 'error']),
  'normalizeResponse':   new PlaceholderNode<NodeStateInterface, 'text' | 'tools' | 'mixed' | 'empty' | 'error'>('urn:noocodec:node:normalize-response', ['text', 'tools', 'mixed', 'empty', 'error']),
  'decodeTextToolCalls': new PlaceholderNode<NodeStateInterface, 'decoded' | 'empty' | 'error'>('urn:noocodec:node:decode-tools', ['decoded', 'empty', 'error']),
  'normalizeToolCalls':  new PlaceholderNode<NodeStateInterface, 'valid' | 'empty' | 'error'>('urn:noocodec:node:normalize-tools', ['valid', 'empty', 'error']),
  'toolWorksets':        new PlaceholderNode<NodeStateInterface, 'ready' | 'empty' | 'error'>('urn:noocodec:node:build-worksets', ['ready', 'empty', 'error']),
  'collectToolResults':  new PlaceholderNode<NodeStateInterface, 'done' | 'empty' | 'error'>('urn:noocodec:node:collect-results', ['done', 'empty', 'error']),
  'appendAssistant':     new PlaceholderNode<NodeStateInterface, 'done' | 'error'>('urn:noocodec:node:append-assistant', ['done', 'error']),
};

export const dag: DAGType = new DAGBuilder(dagIri, '1')
  .node(placement('build-request'), topologyNodes.chatRequest, {
    'ready': placement('call-model'),
    'error': placement('end-error'),
  })
  .node(placement('call-model'), topologyNodes.callModel, {
    'text':  placement('normalize-response'),
    'tools': placement('normalize-response'),
    'mixed': placement('normalize-response'),
    'error': placement('end-error'),
  })
  .node(placement('normalize-response'), topologyNodes.normalizeResponse, {
    'text':  placement('append-assistant'),
    'tools': placement('decode-tools'),
    'mixed': placement('decode-tools'),
    'empty': placement('end-error'),
    'error': placement('end-error'),
  })
  .node(placement('append-assistant'), topologyNodes.appendAssistant, {
    'done':  placement('end-done'),
    'error': placement('end-error'),
  })
  .node(placement('decode-tools'), topologyNodes.decodeTextToolCalls, {
    'decoded': placement('normalize-tools'),
    'empty':   placement('end-error'),
    'error':   placement('end-error'),
  })
  .node(placement('normalize-tools'), topologyNodes.normalizeToolCalls, {
    'valid': placement('worksets'),
    'empty': placement('end-error'),
    'error': placement('end-error'),
  })
  .node(placement('worksets'), topologyNodes.toolWorksets, {
    'ready': placement('dispatch-tools'),
    'empty': placement('end-error'),
    'error': placement('end-error'),
  })
  .scatter(
    placement('dispatch-tools'),
    'safeWorkset',
    { 'dag': { 'from': 'item', 'path': 'dagIri', 'candidates': ['urn:noocodec:tool:calculator'] } },
    {
      'all-success': placement('join-tool-results'),
      'partial':     placement('join-tool-results'),
      'all-error':   placement('join-tool-results'),
      'empty':       placement('join-tool-results'),
    },
    {
      'itemKey': 'currentItem',
    },
  )
  .gather(placement('join-tool-results'), { [placement('dispatch-tools')]: {} }, {
    'strategy': 'map',
    'mapping':  { 'output': 'toolOutputs' },
  }, {
    'success': placement('collect-results'),
    'error':   placement('end-error'),
    'empty':   placement('collect-results'),
  })
  .node(placement('collect-results'), topologyNodes.collectToolResults, {
    'done':  placement('build-request'),
    'empty': placement('build-request'),
    'error': placement('end-error'),
  })
  .terminal(placement('end-done'))
  .terminal(placement('end-error'), { 'outcome': 'failed' })
  .build();
