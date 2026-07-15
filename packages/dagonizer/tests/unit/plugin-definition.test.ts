import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { PluginReceiverType } from '../../src/contracts/PluginInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { defineDagonizerPlugin } from '../../src/plugin/defineDagonizerPlugin.js';
import { PluginSpecifier } from '../../src/plugin/PluginSpecifier.js';
import { TestNode } from '../_support/TestNode.js';

class PluginState extends NodeStateBase {
  query = '';
  documents = '';
}

const placementIri = (dagIri: string, placementName: string): string => `${dagIri}/node/${placementName}`;

const RETRIEVAL_DAG_IRI = 'https://noocodec.dev/plugins/retrieval#search';
const PLUGIN_KNOWN_DAG_IRI = 'https://noocodec.dev/plugins/plugin#known';
const PLUGIN_MISSING_DAG_IRI = 'https://noocodec.dev/plugins/plugin#missing';
const PLUGIN_A_DAG_IRI = 'https://example.com/a#flow';
const PLUGIN_B_DAG_IRI = 'https://example.com/b#flow';
const PLUGIN_FIRST_DAG_IRI = 'https://example.com/first#first';
const PLUGIN_SECOND_DAG_IRI = 'https://example.com/second#second';
const PLUGIN_SHARED_A_DAG_IRI = 'https://example.com/shared#a-flow';
const PLUGIN_SHARED_B_DAG_IRI = 'https://example.com/shared#b-flow';

void describe('defineDagonizerPlugin', () => {
  void it('builds a plugin and registers one bundle', () => {
    const searchNode = TestNode.make<PluginState>('urn:noocodec:node:search', ['success'], (state) => {
      state.documents = `docs:${state.query}`;
      return 'success';
    });

    const searchPlacement = placementIri(RETRIEVAL_DAG_IRI, 'search');
    const donePlacement = placementIri(RETRIEVAL_DAG_IRI, 'done');
    const childDag = new DAGBuilder(RETRIEVAL_DAG_IRI, '1')
      .node(searchPlacement, searchNode, { 'success': donePlacement }, { 'name': 'search' })
      .terminal(donePlacement, { 'name': 'done' })
      .build();

    const plugin = defineDagonizerPlugin({
      'id': '@example/retrieval-plugin',
      'context': { 'retrieval': 'https://noocodec.dev/plugins/retrieval#' },
      'nodes': [searchNode],
      'dags': [childDag],
      'exports': { 'search': RETRIEVAL_DAG_IRI },
    });

    assert.equal(plugin.id, '@example/retrieval-plugin');
    assert.equal(plugin.exports.search, RETRIEVAL_DAG_IRI);

    let bundleCount = 0;
    let receivedBundle: {
      specifier?: string;
      nodes: readonly unknown[];
      dags: readonly unknown[];
      context?: Record<string, unknown>;
    } | null = null;
    const receiver: PluginReceiverType = {
      registerBundle(bundle): void {
        bundleCount += 1;
        receivedBundle = bundle;
      },
    };

    plugin.register(receiver);

    assert.equal(bundleCount, 1);
    if (receivedBundle === null) throw new Error('plugin registerBundle must receive a bundle');
    const bundle = receivedBundle as {
      specifier?: string;
      nodes: readonly unknown[];
      dags: readonly unknown[];
      context?: Record<string, unknown>;
    };
    assert.equal(bundle.specifier, '@example/retrieval-plugin');
    assert.deepEqual(bundle.nodes, [searchNode]);
    assert.deepEqual(bundle.dags, [childDag]);
    assert.deepEqual(bundle.context, { 'retrieval': 'https://noocodec.dev/plugins/retrieval#' });
  });

  void it('throws PLUGIN_INVALID when an export references an unknown DAG', () => {
    const donePlacement = placementIri(PLUGIN_KNOWN_DAG_IRI, 'done');
    const pluginDag = new DAGBuilder(PLUGIN_KNOWN_DAG_IRI, '1')
      .terminal(donePlacement, { 'name': 'done' })
      .entrypoints({ 'main': donePlacement })
      .build();

    assert.throws(
      () => defineDagonizerPlugin({
        'id': '@example/broken-plugin',
        'nodes': [],
        'dags': [pluginDag],
        'exports': { 'broken': PLUGIN_MISSING_DAG_IRI },
      }),
      (err: unknown): err is DAGError => {
        assert.ok(err instanceof DAGError);
        assert.equal(err.code, 'PLUGIN_INVALID');
        assert.match(err.message, /unknown DAG 'https:\/\/noocodec\.dev\/plugins\/plugin#missing'/u);
        return true;
      },
    );
  });

  void it('registerPlugin records prefix ownership for PluginSpecifier.byPrefix', () => {
    const donePlacement = placementIri(RETRIEVAL_DAG_IRI, 'done');
    const pluginDag = new DAGBuilder(RETRIEVAL_DAG_IRI, '1')
      .terminal(donePlacement, { 'name': 'done' })
      .entrypoints({ 'main': donePlacement })
      .build();
    const plugin = defineDagonizerPlugin({
      'id': '@example/retrieval-plugin',
      'context': { 'retrieval': 'https://noocodec.dev/plugins/retrieval#' },
      'nodes': [],
      'dags': [pluginDag],
      'exports': { 'search': RETRIEVAL_DAG_IRI },
    });
    const dispatcher = new Dagonizer<PluginState>();

    dispatcher.registerPlugin(plugin);

    const resolve = PluginSpecifier.byPrefix(dispatcher);
    const resolveIri = PluginSpecifier.byIriPrefix(dispatcher);
    assert.equal(dispatcher.pluginSpecifierForPrefix('retrieval'), '@example/retrieval-plugin');
    assert.equal(dispatcher.pluginSpecifierForPrefix('https://noocodec.dev/plugins/retrieval#'), '@example/retrieval-plugin');
    assert.equal(dispatcher.pluginSpecifierForNamespace('https://noocodec.dev/plugins/retrieval#'), '@example/retrieval-plugin');
    assert.deepEqual([...dispatcher.pluginPrefixSpecifiers()], [
      ['retrieval', '@example/retrieval-plugin'],
      ['https://noocodec.dev/plugins/retrieval#', '@example/retrieval-plugin'],
    ]);
    assert.equal(resolve('retrieval:search'), '@example/retrieval-plugin');
    assert.equal(resolve('https://noocodec.dev/plugins/retrieval#search'), '@example/retrieval-plugin');
    assert.equal(resolveIri('https://noocodec.dev/plugins/retrieval#search'), '@example/retrieval-plugin');
    assert.equal(resolve('plain'), undefined);
    assert.equal(resolve('https://example.com/dag'), undefined);
  });

  void it('registerPlugin rejects a duplicate plugin id with a different implementation', () => {
    const doneA = placementIri(PLUGIN_A_DAG_IRI, 'done');
    const doneB = placementIri(PLUGIN_B_DAG_IRI, 'done');
    const dagA = new DAGBuilder(PLUGIN_A_DAG_IRI, '1')
      .terminal(doneA, { 'name': 'done' })
      .entrypoints({ 'main': doneA })
      .build();
    const dagB = new DAGBuilder(PLUGIN_B_DAG_IRI, '1')
      .terminal(doneB, { 'name': 'done' })
      .entrypoints({ 'main': doneB })
      .build();
    const pluginA = defineDagonizerPlugin({
      'id': '@example/same-plugin',
      'context': { 'a': 'https://example.com/a#' },
      'nodes': [],
      'dags': [dagA],
      'exports': { 'flow': PLUGIN_A_DAG_IRI },
    });
    const pluginB = defineDagonizerPlugin({
      'id': '@example/same-plugin',
      'context': { 'b': 'https://example.com/b#' },
      'nodes': [],
      'dags': [dagB],
      'exports': { 'flow': PLUGIN_B_DAG_IRI },
    });
    const dispatcher = new Dagonizer<PluginState>();

    dispatcher.registerPlugin(pluginA);

    assert.doesNotThrow(() => dispatcher.registerPlugin(pluginA));
    assert.throws(
      () => dispatcher.registerPlugin(pluginB),
      /Plugin id '@example\/same-plugin' is already registered with a different plugin/u,
    );
  });

  void it('registerPlugin rejects conflicting prefix ownership across plugin ids', () => {
    const doneA = placementIri(PLUGIN_FIRST_DAG_IRI, 'done');
    const doneB = placementIri(PLUGIN_SECOND_DAG_IRI, 'done');
    const dagA = new DAGBuilder(PLUGIN_FIRST_DAG_IRI, '1')
      .terminal(doneA, { 'name': 'done' })
      .entrypoints({ 'main': doneA })
      .build();
    const dagB = new DAGBuilder(PLUGIN_SECOND_DAG_IRI, '1')
      .terminal(doneB, { 'name': 'done' })
      .entrypoints({ 'main': doneB })
      .build();
    const pluginA = defineDagonizerPlugin({
      'id': '@example/first-plugin',
      'context': { 'p': 'https://example.com/first#' },
      'nodes': [],
      'dags': [dagA],
      'exports': { 'flow': PLUGIN_FIRST_DAG_IRI },
    });
    const pluginB = defineDagonizerPlugin({
      'id': '@example/second-plugin',
      'context': { 'p': 'https://example.com/second#' },
      'nodes': [],
      'dags': [dagB],
      'exports': { 'flow': PLUGIN_SECOND_DAG_IRI },
    });
    const dispatcher = new Dagonizer<PluginState>();

    dispatcher.registerPlugin(pluginA);

    assert.throws(
      () => dispatcher.registerPlugin(pluginB),
      /Plugin prefix 'p' is already registered to '@example\/first-plugin'/u,
    );
  });

  void it('registerPlugin rejects conflicting namespace ownership and rolls back staged prefix ownership', () => {
    const doneA = placementIri(PLUGIN_SHARED_A_DAG_IRI, 'done');
    const doneB = placementIri(PLUGIN_SHARED_B_DAG_IRI, 'done');
    const dagA = new DAGBuilder(PLUGIN_SHARED_A_DAG_IRI, '1')
      .terminal(doneA, { 'name': 'done' })
      .entrypoints({ 'main': doneA })
      .build();
    const dagB = new DAGBuilder(PLUGIN_SHARED_B_DAG_IRI, '1')
      .terminal(doneB, { 'name': 'done' })
      .entrypoints({ 'main': doneB })
      .build();
    const pluginA = defineDagonizerPlugin({
      'id': '@example/first-plugin',
      'context': { 'a': 'https://example.com/shared#' },
      'nodes': [],
      'dags': [dagA],
      'exports': { 'flow': PLUGIN_SHARED_A_DAG_IRI },
    });
    const pluginB = defineDagonizerPlugin({
      'id': '@example/second-plugin',
      'context': { 'b': 'https://example.com/shared#' },
      'nodes': [],
      'dags': [dagB],
      'exports': { 'flow': PLUGIN_SHARED_B_DAG_IRI },
    });
    const dispatcher = new Dagonizer<PluginState>();

    dispatcher.registerPlugin(pluginA);

    assert.throws(
      () => dispatcher.registerPlugin(pluginB),
      /Plugin namespace 'https:\/\/example\.com\/shared#' is already registered to '@example\/first-plugin'/u,
    );
    assert.equal(dispatcher.pluginSpecifierForPrefix('b'), undefined);
    assert.equal(dispatcher.pluginSpecifierForPrefix('https://example.com/shared#'), '@example/first-plugin');
  });
});
