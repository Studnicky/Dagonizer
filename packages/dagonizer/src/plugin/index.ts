/**
 * `@studnicky/dagonizer/plugin`: DAG-walker and plugin discovery utilities.
 *
 * `PluginDiscovery` provides static methods for finding which DAGs a given entry
 * DAG transitively references via literal `dag` body fields. Use it to determine
 * which plugins must be registered before executing a DAG.
 */

export { PluginDiscovery } from './PluginDiscovery.js';
