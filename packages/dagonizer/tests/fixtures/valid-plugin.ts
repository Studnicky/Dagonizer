import type { PluginInterface } from '../../src/contracts/PluginInterface.js';

const plugin: PluginInterface = {
  'id': '@example/valid-plugin',
  register(): void {
    // Fixture plugin intentionally registers no bundle.
  },
};

export default plugin;
