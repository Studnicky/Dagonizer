/**
 * RegistryBundleInterface: what `RegistryModuleInterface.instantiate` returns.
 *
 * Bundles the DAG/node registry, locally constructed services, the semantic
 * version for the version handshake, and the state restore factory. Services
 * never cross the boundary — each isolate constructs its own services bag via
 * its registry module.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

import type { CheckpointRestoreAdapterInterface } from './CheckpointRestoreAdapterInterface.js';
import type { DispatcherBundleType } from './DispatcherBundle.js';

/**
 * Returned by `RegistryModuleInterface.instantiate`. Bundles the DAG/node
 * registry, locally constructed services, the semantic version for the
 * version handshake, and the state restore factory.
 */
export interface RegistryBundleInterface<TServices = unknown> {
  /** Nodes and DAGs to register in the host dispatcher. */
  bundle: DispatcherBundleType<NodeStateInterface, unknown>;
  /**
   * Locally constructed services bag. Opaque to the protocol; `TServices`
   * defaults to `unknown` so existing call sites stay source-compatible,
   * while a registry that knows its services shape narrows it without a cast.
   */
  services: TServices;
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
