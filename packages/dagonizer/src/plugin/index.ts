/**
 * `@studnicky/dagonizer/plugin`: DAG-walker, plugin discovery, and plugin loader utilities.
 *
 * `PluginDiscovery` provides static methods for finding which DAGs a given entry
 * DAG transitively references via literal `dag` body fields. Use it to determine
 * which plugins must be registered before executing a DAG.
 *
 * `PluginLoader` provides type-safe dynamic import of plugin packages —
 * `PluginLoader.load(specifier)` imports and validates the default export as a
 * `PluginInterface` without requiring an unsafe cast at the call site.
 */

export { PluginDiscovery } from './PluginDiscovery.js';
export { PluginLoader } from './PluginLoader.js';
export { PluginSpecifier } from './PluginSpecifier.js';
