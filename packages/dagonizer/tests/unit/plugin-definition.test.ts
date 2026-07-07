import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGBuilder } from '../../src/builder/DAGBuilder.js';
import type { PluginReceiverType } from '../../src/contracts/PluginInterface.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { NodeStateBase } from '../../src/NodeStateBase.js';
import { defineDagonizerPlugin } from '../../src/plugin/defineDagonizerPlugin.js';
import { PluginLoader } from '../../src/plugin/PluginLoader.js';
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
      'context': { 'retrieval': 'https://noocodex.dev/plugins/retrieval#' },
      'nodes': [searchNode],
      'dags': [childDag],
      'exports': { 'search': 'retrieval:search' },
    });

    assert.equal(PluginLoader.validate(plugin, 'retrieval-plugin'), plugin);
    assert.equal(plugin.exports.search, 'retrieval:search');

    let bundleCount = 0;
    let receivedBundle: {
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
      nodes: readonly unknown[];
      dags: readonly unknown[];
      context?: Record<string, unknown>;
    };
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
});
