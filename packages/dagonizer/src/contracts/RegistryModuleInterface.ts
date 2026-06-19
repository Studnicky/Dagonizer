/**
 * RegistryModuleInterface: what DagHost dynamic-imports as the isolate registry.
 *
 * The default export of the module must implement `RegistryModuleInterface`.
 * `instantiate` constructs services locally using the provided configuration
 * (passed from the `init` message's `servicesConfig`) and returns a
 * `RegistryBundleInterface` with the nodes, DAGs, services, and version.
 *
 * Services never cross the boundary — each isolate constructs its own services
 * bag via its registry module.
 */

import type { JsonObjectType } from '../entities/json.js';

import type { RegistryBundleInterface } from './RegistryBundleInterface.js';

/**
 * Default export shape of a registry module loaded by DagHost via dynamic import.
 */
export interface RegistryModuleInterface<TServices = unknown> {
  /**
   * Construct the service bag and return the fully initialised bundle.
   * `servicesConfig` is the opaque JSON object from the `init` message —
   * the registry module interprets it to wire its dependencies. `TServices`
   * defaults to `unknown`; a module that knows its services shape narrows it.
   */
  instantiate(servicesConfig: JsonObjectType): Promise<RegistryBundleInterface<TServices>>;
}
