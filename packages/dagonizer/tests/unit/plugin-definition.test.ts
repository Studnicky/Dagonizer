import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { PluginReceiverType } from '../../src/contracts/PluginInterface.js';
import { Dagonizer } from '../../src/Dagonizer.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { defineDagonizerPlugin } from '../../src/plugin/defineDagonizerPlugin.js';
import { PluginLoader } from '../../src/plugin/PluginLoader.js';
import { PluginSpecifier } from '../../src/plugin/PluginSpecifier.js';
import { TestNode } from '../_support/TestNode.js';

class PluginState extends NodeStateBase {
  query = '';
  documents = '';
}

void describe('defineDagonizerPlugin', () => {
  void it('builds a plugin accepted by PluginLoader.validate and registers one bundle', () => {
    const searchNode = TestNode.make<PluginState>('search', ['success'], (state) => {
      state.documents = `docs:${state.query}`;
      return 'success';
    });

    const childDag = new DAGBuilder('retrieval:search', '1')
      .node('search', searchNode, { 'success': 'done' })
      .terminal('done')
      .build();

    const plugin = defineDagonizerPlugin({
      'id': '@example/retrieval-plugin',
      'context': { 'retrieval': 'https://noocodex.dev/plugins/retrieval#' },
      'nodes': [searchNode],
      'dags': [childDag],
      'exports': { 'search': 'retrieval:search' },
    });

    assert.equal(PluginLoader.validate(plugin, 'retrieval-plugin'), plugin);
    assert.equal(plugin.id, '@example/retrieval-plugin');
    assert.equal(plugin.exports.search, 'retrieval:search');

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
    assert.deepEqual(bundle.context, { 'retrieval': 'https://noocodex.dev/plugins/retrieval#' });
  });

  void it('throws PLUGIN_INVALID when an export references an unknown DAG', () => {
    const pluginDag = new DAGBuilder('plugin:known', '1')
      .terminal('done')
      .entrypoint('done')
      .build();

    assert.throws(
      () => defineDagonizerPlugin({
        'id': '@example/broken-plugin',
        'nodes': [],
        'dags': [pluginDag],
        'exports': { 'broken': 'plugin:missing' },
      }),
      (err: unknown): err is DAGError => {
        assert.ok(err instanceof DAGError);
        assert.equal(err.code, 'PLUGIN_INVALID');
        assert.match(err.message, /unknown DAG 'plugin:missing'/u);
        return true;
      },
    );
  });

  void it('registerPlugin records prefix ownership for PluginSpecifier.byPrefix', () => {
    const pluginDag = new DAGBuilder('retrieval:search', '1')
      .terminal('done')
      .entrypoint('done')
      .build();
    const plugin = defineDagonizerPlugin({
      'id': '@example/retrieval-plugin',
      'context': { 'retrieval': 'https://noocodex.dev/plugins/retrieval#' },
      'nodes': [],
      'dags': [pluginDag],
      'exports': { 'search': 'retrieval:search' },
    });
    const dispatcher = new Dagonizer<PluginState>();

    dispatcher.registerPlugin(plugin);

    const resolve = PluginSpecifier.byPrefix(dispatcher);
    const resolveIri = PluginSpecifier.byIriPrefix(dispatcher);
    assert.equal(dispatcher.pluginSpecifierForPrefix('retrieval'), '@example/retrieval-plugin');
    assert.equal(dispatcher.pluginSpecifierForPrefix('https://noocodex.dev/plugins/retrieval#'), '@example/retrieval-plugin');
    assert.equal(dispatcher.pluginSpecifierForNamespace('https://noocodex.dev/plugins/retrieval#'), '@example/retrieval-plugin');
    assert.deepEqual([...dispatcher.pluginPrefixSpecifiers()], [
      ['retrieval', '@example/retrieval-plugin'],
      ['https://noocodex.dev/plugins/retrieval#', '@example/retrieval-plugin'],
    ]);
    assert.equal(resolve('retrieval:search'), '@example/retrieval-plugin');
    assert.equal(resolve('https://noocodex.dev/plugins/retrieval#search'), '@example/retrieval-plugin');
    assert.equal(resolveIri('https://noocodex.dev/plugins/retrieval#search'), '@example/retrieval-plugin');
    assert.equal(resolve('plain'), undefined);
    assert.equal(resolve('https://example.com/dag'), undefined);
  });

  void it('registerPlugin rejects a duplicate plugin id with a different implementation', () => {
    const dagA = new DAGBuilder('a:flow', '1').terminal('done').entrypoint('done').build();
    const dagB = new DAGBuilder('b:flow', '1').terminal('done').entrypoint('done').build();
    const pluginA = defineDagonizerPlugin({
      'id': '@example/same-plugin',
      'context': { 'a': 'https://example.com/a#' },
      'nodes': [],
      'dags': [dagA],
      'exports': { 'flow': 'a:flow' },
    });
    const pluginB = defineDagonizerPlugin({
      'id': '@example/same-plugin',
      'context': { 'b': 'https://example.com/b#' },
      'nodes': [],
      'dags': [dagB],
      'exports': { 'flow': 'b:flow' },
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
    const dagA = new DAGBuilder('p:first', '1').terminal('done').entrypoint('done').build();
    const dagB = new DAGBuilder('p:second', '1').terminal('done').entrypoint('done').build();
    const pluginA = defineDagonizerPlugin({
      'id': '@example/first-plugin',
      'context': { 'p': 'https://example.com/first#' },
      'nodes': [],
      'dags': [dagA],
      'exports': { 'flow': 'p:first' },
    });
    const pluginB = defineDagonizerPlugin({
      'id': '@example/second-plugin',
      'context': { 'p': 'https://example.com/second#' },
      'nodes': [],
      'dags': [dagB],
      'exports': { 'flow': 'p:second' },
    });
    const dispatcher = new Dagonizer<PluginState>();

    dispatcher.registerPlugin(pluginA);

    assert.throws(
      () => dispatcher.registerPlugin(pluginB),
      /Plugin prefix 'p' is already registered to '@example\/first-plugin'/u,
    );
  });

  void it('registerPlugin rejects conflicting namespace ownership and rolls back staged prefix ownership', () => {
    const dagA = new DAGBuilder('a:flow', '1').terminal('done').entrypoint('done').build();
    const dagB = new DAGBuilder('b:flow', '1').terminal('done').entrypoint('done').build();
    const pluginA = defineDagonizerPlugin({
      'id': '@example/first-plugin',
      'context': { 'a': 'https://example.com/shared#' },
      'nodes': [],
      'dags': [dagA],
      'exports': { 'flow': 'a:flow' },
    });
    const pluginB = defineDagonizerPlugin({
      'id': '@example/second-plugin',
      'context': { 'b': 'https://example.com/shared#' },
      'nodes': [],
      'dags': [dagB],
      'exports': { 'flow': 'b:flow' },
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
