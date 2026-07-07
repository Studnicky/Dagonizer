/**
 * PluginInterface: the one-method contract every plugin package implements.
 *
 * A plugin receives a live `Dagonizer` (typed as a narrow receiver that only
 * exposes `registerBundle`) and calls `registerBundle()` on it — the same gate
 * every inline bundle registration uses. The plugin cannot reach inside the
 * dispatcher; it can only add nodes and DAGs through the public `registerBundle`
 * seam.
 *
 * The pattern name is the IRI of the plugin's primary DAG (its entry DAG): the
 * IRI acts as the plugin's namespace key so two plugins sharing a common node
 * name cannot collide (IRI identity keying is already in place).
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
