import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DAGError } from '../../src/errors/DAGError.js';
import { PluginLoader } from '../../src/plugin/PluginLoader.js';

const VALID_PLUGIN = new URL('../fixtures/valid-plugin.js', import.meta.url).href;
const INVALID_PLUGIN = new URL('../fixtures/invalid-plugin.js', import.meta.url).href;

void describe('PluginLoader.load', () => {
  void it('imports and validates a default-exported plugin', async () => {
    const plugin = await PluginLoader.load(VALID_PLUGIN);

    assert.equal(plugin.id, '@example/valid-plugin');
    assert.equal(typeof plugin.register, 'function');
  });

  void it('throws PLUGIN_INVALID when the default export is not a plugin', async () => {
    await assert.rejects(
      () => PluginLoader.load(INVALID_PLUGIN),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, 'Expected DAGError');
        assert.equal(err.code, 'PLUGIN_INVALID');
        assert.ok(err.message.includes(INVALID_PLUGIN));
        return true;
      },
    );
  });
});
