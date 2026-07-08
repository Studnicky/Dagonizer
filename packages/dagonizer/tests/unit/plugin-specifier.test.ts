import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PluginSpecifier } from '../../src/plugin/PluginSpecifier.js';

void describe('PluginSpecifier.bareName', () => {
  void it('returns the bare package specifier unchanged', () => {
    assert.equal(PluginSpecifier.bareName('@scope/p'), '@scope/p');
  });

  void it('returns a plain package name unchanged', () => {
    assert.equal(PluginSpecifier.bareName('my-plugin'), 'my-plugin');
  });
});

void describe('PluginSpecifier.rootedAt', () => {
  void it('resolves a bare package specifier to an absolute URL under the base', () => {
    const resolve = PluginSpecifier.rootedAt('https://cdn.example.com/x/');
    assert.equal(resolve('plug'), 'https://cdn.example.com/x/plug.js');
  });

  void it('passes through an absolute name unchanged', () => {
    const resolve = PluginSpecifier.rootedAt('https://cdn.example.com/x/');
    assert.equal(resolve('https://other.example.com/y.js'), 'https://other.example.com/y.js');
  });

  void it('passes through a name with http protocol unchanged', () => {
    const resolve = PluginSpecifier.rootedAt('https://cdn.example.com/x/');
    assert.equal(resolve('http://cdn.example.com/a.js'), 'http://cdn.example.com/a.js');
  });
});

void describe('PluginSpecifier.byIriPrefix', () => {
  void it('resolves hash and slash namespace IRIs through the namespace lookup source', () => {
    const namespaces = new Map([
      ['https://noocodex.dev/plugins/retrieval#', '@example/retrieval-plugin'],
      ['https://noocodex.dev/plugins/tools/', '@example/tools-plugin'],
    ]);
    const resolve = PluginSpecifier.byIriPrefix({
      pluginSpecifierForNamespace(namespaceIri: string): string | undefined {
        return namespaces.get(namespaceIri);
      },
    });

    assert.equal(resolve('https://noocodex.dev/plugins/retrieval#search'), '@example/retrieval-plugin');
    assert.equal(resolve('https://noocodex.dev/plugins/tools/search'), '@example/tools-plugin');
    assert.equal(resolve('retrieval:search'), undefined);
    assert.equal(resolve('https://noocodex.dev/plugins/unknown#search'), undefined);
  });
});
