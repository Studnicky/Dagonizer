/**
 * container-validation.test.ts
 *
 * Validation rule for W1: a ScatterNode with a node body and a container key
 * must throw a ValidationError at registerDAG time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NodeInterface } from '../../src/contracts/NodeInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAG } from '../../src/entities/index.js';
import { ValidationError } from '../../src/errors/index.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';

const bodyNode: NodeInterface<NodeStateBase, 'success'> = {
  'name': 'body-node',
  'outputs': ['success'],
  async execute() { return { 'output': 'success' }; },
};

// A ScatterNode with a node body AND a container key — this is a validation error.
const invalidDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:invalid',
  '@type':    'DAG',
  'name':     'invalid',
  'version':  '1',
  'entrypoint': 'scatter',
  'nodes': [
    {
      '@id':       'urn:noocodex:dag:invalid/node/scatter',
      '@type':     'ScatterNode',
      'name':      'scatter',
      'source':    'items',
      'body':      { 'node': 'body-node' },
      'gather':    { 'strategy': 'discard' },
      'container': 'cpu',
      'outputs':   {
        'all-success': null,
        'partial':     null,
        'all-error':   null,
        'empty':       null,
      },
    } as DAG['nodes'][number],
  ],
};

// A ScatterNode with a dag body AND a container key — this is valid.
const validDagBodyDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:valid-dag-body',
  '@type':    'DAG',
  'name':     'valid-dag-body',
  'version':  '1',
  'entrypoint': 'scatter',
  'nodes': [
    {
      '@id':       'urn:noocodex:dag:valid-dag-body/node/scatter',
      '@type':     'ScatterNode',
      'name':      'scatter',
      'source':    'items',
      'body':      { 'dag': 'child' },
      'gather':    { 'strategy': 'discard' },
      'container': 'cpu',
      'outputs':   {
        'all-success': null,
        'partial':     null,
        'all-error':   null,
        'empty':       null,
      },
    } as DAG['nodes'][number],
  ],
};

const childDAG: DAG = {
  '@context': DAG_CONTEXT,
  '@id':      'urn:noocodex:dag:child',
  '@type':    'DAG',
  'name':     'child',
  'version':  '1',
  'entrypoint': 'body-node',
  'nodes': [
    {
      '@id':     'urn:noocodex:dag:child/node/body-node',
      '@type':   'SingleNode',
      'name':    'body-node',
      'node':    'body-node',
      'outputs': { 'success': null },
    },
  ],
};

void describe('Container validation — node-body scatter', () => {
  void it('throws ValidationError when ScatterNode has node body AND container key', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(bodyNode);

    assert.throws(
      () => dispatcher.registerDAG(invalidDAG),
      ValidationError,
      'Expected a ValidationError for node-body scatter with container',
    );
  });

  void it('does not throw when ScatterNode has dag body AND container key', () => {
    const warnings: string[] = [];
    class ObserveDagonizer extends Dagonizer<NodeStateBase> {
      protected override onContractWarning(msg: string) { warnings.push(msg); }
    }

    const dispatcher = new ObserveDagonizer();
    dispatcher.registerNode(bodyNode);
    dispatcher.registerDAG(childDAG);

    // Should not throw — dag body with container is valid
    assert.doesNotThrow(() => dispatcher.registerDAG(validDagBodyDAG));
  });
});
