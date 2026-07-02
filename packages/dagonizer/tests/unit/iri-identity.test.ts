/**
 * IRI-keyed identity tests (A1).
 *
 * Verifies that:
 *   (a) Two nodes with the same bare name registered under different bundle
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
  void it('two nodes with the same bare name under distinct prefixes coexist', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();

    const contextA: Record<string, unknown> = { 'pluginA': 'https://a.example.com/' };
    const contextB: Record<string, unknown> = { 'pluginB': 'https://b.example.com/' };

    // Node names include the prefix: 'pluginA:fanout' and 'pluginB:fanout'.
    // Each resolves to a different IRI key via the bundle-level context.
    const fanoutAP = TestNode.make('pluginA:fanout', ['success'], () => 'success');
    const fanoutBP = TestNode.make('pluginB:fanout', ['success'], () => 'success');

    dispatcher.registerBundle({ 'nodes': [fanoutAP], 'dags': [], 'context': contextA });
    dispatcher.registerBundle({ 'nodes': [fanoutBP], 'dags': [], 'context': contextB });

    // Both IRIs must be distinct entries in the registry.
    const iriA = ContextResolver.expand('pluginA:fanout', contextA);
    const iriB = ContextResolver.expand('pluginB:fanout', contextB);

    assert.notStrictEqual(iriA, iriB, 'prefix-expanded IRIs must differ');
    assert.strictEqual(dispatcher.getNode(iriA), fanoutAP, 'pluginA:fanout resolves to fanoutAP');
    assert.strictEqual(dispatcher.getNode(iriB), fanoutBP, 'pluginB:fanout resolves to fanoutBP');
    assert.strictEqual(dispatcher.nodeNames().length, 2, 'registry must hold both nodes without collision');
  });

  void it('two bare-name nodes differ in IRI from two prefixed nodes with the same local part', () => {
    const contextA: Record<string, unknown> = { 'pluginA': 'https://a.example.com/' };

    const bareIri = ContextResolver.expand('increment', {});
    const prefixedIri = ContextResolver.expand('pluginA:increment', contextA);

    assert.notStrictEqual(bareIri, prefixedIri, 'bare name and prefixed name must not alias');
    assert.strictEqual(bareIri, `${ContextResolver.DEFAULT_NS}increment`);
    assert.strictEqual(prefixedIri, 'https://a.example.com/increment');
  });

  void it('bare-name nodes with the same name ARE the same registry key', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();

    const nodeA = TestNode.make('increment', ['success'], () => 'success');

    // Two registerNode calls for the same node (identity check) — OK.
    dispatcher.registerNode(nodeA);
    dispatcher.registerNode(nodeA);

    assert.strictEqual(dispatcher.nodeNames().length, 1, 'same node registered twice stays as one entry');
  });

  void it('duplicate bare-name registration of DIFFERENT nodes throws', () => {
    const dispatcher = new Dagonizer<NodeStateBase>();

    dispatcher.registerNode(TestNode.make('increment', ['success'], () => 'success'));

    assert.throws(
      () => dispatcher.registerNode(TestNode.make('increment', ['success'], () => 'success')),
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
    dispatcher.registerNode(TestNode.make('step', ['done'], () => 'done'));

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
      'entrypoint': 'step',
      'nodes': [
        {
          '@id': 'urn:test:collision-dag/node/step', '@type': 'SingleNode',
          'name': 'step', 'node': 'step', 'outputs': { 'done': 'end' },
        },
        {
          '@id': 'urn:test:collision-dag/node/end', '@type': 'TerminalNode',
          'name': 'end', 'outcome': 'completed',
        },
      ],
    };

    const dagsBefore = dispatcher.dagNames().length;
    assert.throws(
      () => dispatcher.registerDAG(collidingDag),
      (err: unknown) => {
        assert.ok(err instanceof DAGError);
        return true;
      },
    );
    assert.strictEqual(dispatcher.dagNames().length, dagsBefore, 'dags registry must not be mutated on rejection');
  });

  void it('ContextResolver.validate accepts a context with distinct namespace IRIs', () => {
    const validContext: Record<string, unknown> = {
      'pluginA': 'https://a.example.com/',
      'pluginB': 'https://b.example.com/',
    };

    assert.doesNotThrow(() => ContextResolver.validate(validContext));
  });
});
