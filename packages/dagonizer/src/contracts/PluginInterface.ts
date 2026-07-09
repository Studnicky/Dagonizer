/**
 * PluginInterface: the one-method contract every plugin package implements.
 *
 * A plugin receives a live `Dagonizer` (typed as a narrow receiver that only
 * exposes `registerBundle`) and calls `registerBundle()` on it — the same gate
 * every inline bundle registration uses. The plugin cannot reach inside the
 * dispatcher; it can only add nodes and DAGs through the public `registerBundle`
 * seam.
 *
 * The plugin id is the stable package/specifier identity. The bundle context
 * supplies the JSON-LD prefixes that scope node and DAG IRIs, so plugins can
 * share local names without colliding in the IRI-keyed registries.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { DispatcherBundleType } from './DispatcherBundle.js';

/** Narrow dispatcher receiver exposed to plugins: only `registerBundle` is visible. */
export type PluginReceiverType = {
  registerBundle(bundle: DispatcherBundleType<NodeStateInterface>): void;
};

/**
 * Contract every plugin package implements. Called once, in registration order,
 * by `Dagonizer.registerPlugin`.
 */
export interface PluginInterface {
  /** Stable plugin package/specifier id. Duplicate ids must identify the same plugin object. */
  readonly id: string;
  /** Called once, in registration order, by `Dagonizer.registerPlugin`. */
  register(dispatcher: PluginReceiverType): void;
}
