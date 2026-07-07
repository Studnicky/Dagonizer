/**
 * RegistryBundleInterface: what `RegistryModuleInterface.instantiate` returns.
 *
 * Bundles the DAG/node registry, the semantic version for the version
 * handshake, and the state restore factory. A node's dependencies never cross
 * the worker boundary — the registry module constructs each node with its
 * dependencies (derived from the init message's `servicesConfig`) inside the
 * isolate.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { CheckpointRestoreAdapterInterface } from './CheckpointRestoreAdapterInterface.js';
import type { DispatcherBundleType } from './DispatcherBundle.js';

/**
 * Returned by `RegistryModuleInterface.instantiate`. Bundles the DAG/node
 * registry, the semantic version for the version handshake, and the state
 * restore factory.
 */
export interface RegistryBundleInterface {
  /**
   * Nodes and DAGs to register in the host dispatcher.
   */
  bundle: DispatcherBundleType<NodeStateInterface>;
  /** Semantic version used for the init ↔ ready version handshake. */
  registryVersion: string;
  /**
   * Adapter that restores a state instance from a JSON snapshot.
   * Implement `restore(snapshot)` to rehydrate domain state.
   */
  restoreState: CheckpointRestoreAdapterInterface<NodeStateInterface>;
  /**
   * Optional teardown hook. Called by `DagHost` on shutdown before the host
   * process/thread exits, so node resources (DB connections, file handles, etc.)
   * are released cleanly.
   *
   * Extension contract: this is a legitimate optional seam. Bundles that open no
   * long-lived resources may omit `destroy` entirely — `DagHost` uses optional
   * chaining (`this.#bundle.destroy?.()`) and suppresses errors so a missing or
   * throwing `destroy` never blocks channel close. Implementations MUST NOT throw
   * exceptions that they want the host to observe; wrap all teardown in try/catch
   * internally and resolve regardless of teardown outcome.
   *
   * Rationale for remaining optional: requiring a no-op implementation on every
   * bundle would add mandatory boilerplate for the common case (no teardown work)
   * and would make simple in-test bundles more verbose without correctness benefit.
   */
  destroy?(): Promise<void>;
}
