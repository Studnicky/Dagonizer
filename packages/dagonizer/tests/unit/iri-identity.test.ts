/**
 * IRI-keyed identity tests (A1).
 *
 * Verifies that:
 *   (a) Two nodes with the same local name registered under different bundle
 *       @context prefixes resolve to distinct IRI keys and coexist in the
 *       registry without collision.
 *   (b) A DAG @context with two different prefix keys mapping to the same
 *       namespace IRI is rejected with a DAGError at registerDAG time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ContextResolver } from '../../src/dag/ContextResolver.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAG_CONTEXT } from '../../src/entities/dag/DAG.js';
import type { DAGType } from '../../src/entities/index.js';
import { DAGError } from '../../src/errors/index.js';
import type { NodeStateBase } from '../../src/NodeStateBase.js';
import { TestNode } from '../_support/TestNode.js';

// ── (a) Prefix-isolated node coexistence ─────────────────────────────────────

void describe('IRI identity — prefix-isolated node coexistence', () => {
  void it('two nodes with the same local name under distinct prefixes coexist', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();

    const contextA: Record<string, unknown> = { 'pluginA': 'https://a.example.com/' };
    const contextB: Record<string, unknown> = { 'pluginB': 'https://b.example.com/' };

    const iriA = ContextResolver.expand('pluginA:fanout', contextA);
    const iriB = ContextResolver.expand('pluginB:fanout', contextB);
    const fanoutAP = TestNode.make(iriA, ['success'], () => 'success');
    const fanoutBP = TestNode.make(iriB, ['success'], () => 'success');

    dispatcher.registerBundle({ 'nodes': [fanoutAP], 'dags': [], 'context': contextA });
    dispatcher.registerBundle({ 'nodes': [fanoutBP], 'dags': [], 'context': contextB });

    assert.notStrictEqual(iriA, iriB, 'prefix-expanded IRIs must differ');
    assert.strictEqual(dispatcher.getNode(iriA), fanoutAP, 'pluginA:fanout resolves to fanoutAP');
    assert.strictEqual(dispatcher.getNode(iriB), fanoutBP, 'pluginB:fanout resolves to fanoutBP');
    assert.strictEqual(dispatcher.nodeIris().length, 2, 'registry must hold both nodes without collision');
  });

  void it('bare references are rejected instead of being assigned a default namespace', () => {
    const contextA: Record<string, unknown> = { 'pluginA': 'https://a.example.com/' };

    const prefixedIri = ContextResolver.expand('pluginA:increment', contextA);

    assert.throws(
      () => ContextResolver.expand('increment', {}),
      /must be an absolute IRI or declared CURIE/u,
    );
    assert.strictEqual(prefixedIri, 'https://a.example.com/increment');
  });

  void it('same node IRI registered twice for the same object stays one registry entry', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();

    const nodeA = TestNode.make('urn:noocodec:node:increment', ['success'], () => 'success');

    // Two registerNode calls for the same node (identity check) — OK.
    dispatcher.registerNode(nodeA);
    dispatcher.registerNode(nodeA);

    assert.strictEqual(dispatcher.nodeIris().length, 1, 'same node registered twice stays as one entry');
  });

  void it('duplicate node IRI registration of different nodes throws', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();

    dispatcher.registerNode(TestNode.make('urn:noocodec:node:increment', ['success'], () => 'success'));

    assert.throws(
      () => dispatcher.registerNode(TestNode.make('urn:noocodec:node:increment', ['success'], () => 'success')),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.ok(err.message.includes('already registered'), `expected 'already registered', got: ${err.message}`);
        return true;
      },
    );
  });
});

// ── (b) Duplicate prefix context rejection ────────────────────────────────────

void describe('IRI identity — duplicate prefix rejection', () => {
  void it('ContextResolver.validate throws on two prefixes mapping to the same namespace', () => {
    const collisionContext: Record<string, unknown> = {
      'pluginA': 'https://shared.example.com/',
      'pluginB': 'https://shared.example.com/',
    };

    assert.throws(
      () => ContextResolver.validate(collisionContext),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        assert.ok(
          err.message.includes('collision') || err.message.includes('both map to'),
          `expected collision message, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  void it('registerDAG with a colliding @context throws DAGError before mutating registries', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();
    dispatcher.registerNode(TestNode.make('urn:noocodec:node:step', ['done'], () => 'done'));

    const collidingDag: DAGType = {
      '@context': {
        ...DAG_CONTEXT,
        'alpha': 'https://collision.example.com/',
        'beta':  'https://collision.example.com/',
      },
      '@id':        'urn:test:collision-dag',
      '@type':      'DAG',
      'name':       'collision-dag',
      'version':    '1',
      'entrypoints': { 'main': 'step' },
      'nodes': [
        {
          '@id': 'urn:test:collision-dag/node/step', '@type': 'SingleNode',
          'name': 'step', 'node': 'urn:noocodec:node:step', 'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:test:collision-dag/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed',
        },
      ],
    };

    const dagsBefore = dispatcher.dagIris().length;
    assert.throws(
      () => dispatcher.registerDAG(collidingDag),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        return true;
      },
    );
    assert.strictEqual(dispatcher.dagIris().length, dagsBefore, 'dags registry must not be mutated on rejection');
  });

  void it('ContextResolver.validate accepts a context with distinct namespace IRIs', () => {
    const validContext: Record<string, unknown> = {
      'pluginA': 'https://a.example.com/',
      'pluginB': 'https://b.example.com/',
    };

    assert.doesNotThrow(() => ContextResolver.validate(validContext));
  });
});
