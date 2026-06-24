import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PluginReceiverType } from '../../src/contracts/PluginInterface.js';
import { DAGError } from '../../src/errors/DAGError.js';
import { PluginLoader } from '../../src/plugin/PluginLoader.js';

// ---------------------------------------------------------------------------
// PluginLoader.isPlugin
// ---------------------------------------------------------------------------

void describe('PluginLoader.isPlugin', () => {
  void it('returns true for a valid { register: fn } object', () => {
    const candidate = { "register": (_dispatcher: PluginReceiverType) => { /* no-op */ } };
    assert.equal(PluginLoader.isPlugin(candidate), true);
  });

  void it('returns false for null', () => {
    assert.equal(PluginLoader.isPlugin(null), false);
  });

  void it('returns false for a string', () => {
    assert.equal(PluginLoader.isPlugin('my-plugin'), false);
  });

  void it('returns false for an object missing the register method', () => {
    assert.equal(PluginLoader.isPlugin({ "name": 'no-register' }), false);
  });

  void it('returns false for an object where register is not a function', () => {
    assert.equal(PluginLoader.isPlugin({ "register": 'not-a-function' }), false);
  });

  void it('returns false for undefined', () => {
    assert.equal(PluginLoader.isPlugin(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// PluginLoader.validate
// ---------------------------------------------------------------------------

void describe('PluginLoader.validate', () => {
  void it('returns the plugin when default export is a valid plugin', () => {
    const plugin = { "register": (_dispatcher: PluginReceiverType) => { /* no-op */ } };
    const mod = { "default": plugin };
    const result = PluginLoader.validate(mod, 'test-module');
    assert.equal(result, plugin);
  });

  void it('accepts the plugin directly (no default wrapper) when it has register', () => {
    const plugin = { "register": (_dispatcher: PluginReceiverType) => { /* no-op */ } };
    const result = PluginLoader.validate(plugin, 'test-module');
    assert.equal(result, plugin);
  });

  void it('throws DAGError with code PLUGIN_INVALID for null default export', () => {
    const mod = { "default": null };
    assert.throws(
      () => PluginLoader.validate(mod, 'bad-module'),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, 'Expected DAGError');
        assert.equal(err.code, 'PLUGIN_INVALID');
        assert.ok(err.message.includes('bad-module'));
        return true;
      },
    );
  });

  void it('throws DAGError with code PLUGIN_INVALID when default is missing register', () => {
    const mod = { "default": { "name": 'not-a-plugin' } };
    assert.throws(
      () => PluginLoader.validate(mod, 'missing-register'),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, 'Expected DAGError');
        assert.equal(err.code, 'PLUGIN_INVALID');
        return true;
      },
    );
  });

  void it('throws DAGError with code PLUGIN_INVALID for a plain string module', () => {
    assert.throws(
      () => PluginLoader.validate('not-an-object', 'string-module'),
      (err: unknown) => {
        assert.ok(err instanceof DAGError, 'Expected DAGError');
        assert.equal(err.code, 'PLUGIN_INVALID');
        return true;
      },
    );
  });
});
