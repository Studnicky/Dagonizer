/**
 * `@studnicky/dagonizer/plugin`: DAG-walker, plugin discovery, and plugin loader utilities.
 *
 * `PluginDiscovery` provides graph-backed methods for finding which DAGs a
 * given entry DAG transitively references via literal and dynamic `DagReference`
 * candidate edges. Use it to determine which plugins must be registered before
 * executing a DAG.
 *
 * `PluginLoader` provides type-safe dynamic import of plugin packages —
 * `PluginLoader.load(specifier)` imports and validates the default export as a
 * `PluginInterface` without requiring an unsafe cast at the call site.
 */

export { PluginDiscovery } from './PluginDiscovery.js';
export { PluginLoader } from './PluginLoader.js';
export { defineDagonizerPlugin } from './defineDagonizerPlugin.js';
export type {
  DagonizerPluginDefinitionType,
  DefinedDagonizerPluginType,
} from './defineDagonizerPlugin.js';
export { PluginSpecifier } from './PluginSpecifier.js';
