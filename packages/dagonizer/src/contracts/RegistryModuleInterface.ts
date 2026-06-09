/**
 * RegistryModuleInterface: what DagHost dynamic-imports as the isolate registry.
 *
 * The default export of the module must implement `RegistryModuleInterface`.
 * `createBundle` constructs services locally using the provided configuration
 * (passed from the `init` message's `servicesConfig`) and returns a
 * `RegistryBundleInterface` with the nodes, DAGs, services, and version.
 *
 * Services never cross the boundary — each isolate constructs its own services
 * bag via its registry module.
 */

import type { StateRestoreFnType } from '../checkpoint/Checkpoint.js';
import type { DispatcherBundle } from '../Dagonizer.js';
import type { JsonObject } from '../entities/json.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * Returned by `RegistryModuleInterface.createBundle`. Bundles the DAG/node
 * registry, locally constructed services, the semantic version for the
 * version handshake, and the state restore factory.
 */
export interface RegistryBundleInterface {
  /** Nodes and DAGs to register in the host dispatcher. */
  readonly bundle: DispatcherBundle<NodeStateInterface, unknown>;
  /** Locally constructed services bag. Opaque to the protocol. */
  readonly services: unknown;
  /** Semantic version used for the init ↔ ready version handshake. */
  readonly registryVersion: string;
  /**
   * Factory that restores a state instance from a snapshot.
   * The canonical name from `checkpoint/Checkpoint.ts` is used directly.
   */
  readonly restoreState: StateRestoreFnType<NodeStateInterface>;
}

/**
 * Default export shape of a registry module loaded by DagHost via dynamic import.
 */
export interface RegistryModuleInterface {
  /**
   * Construct the service bag and return the fully initialised bundle.
   * `servicesConfig` is the opaque JSON object from the `init` message —
   * the registry module interprets it to wire its dependencies.
   */
  createBundle(servicesConfig: JsonObject): Promise<RegistryBundleInterface>;
}
