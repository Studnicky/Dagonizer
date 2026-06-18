/**
 * registry.ts: ConformanceRegistry default export for WebWorkerContainer tests.
 *
 * Provides a module default export (`RegistryModuleInterface`) for DagHost
 * to dynamic-import. DagHost reads `mod.default` after importing a registry
 * module URL; this file implements `RegistryModuleInterface` using
 * `ConformanceRegistry.bundle()` from the testing barrel.
 *
 * The module URL is derived from this file's compiled output at dist-test time:
 *
 *   new URL('./fixtures/registry.js', import.meta.url).href
 *
 * This pattern follows the W3 conformance idiom: downstream packages implement
 * `RegistryModuleInterface` locally so the DagHost can dynamic-import it from
 * their test tree.
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObject } from '@studnicky/dagonizer/entities';
import { ConformanceRegistry } from '@studnicky/dagonizer/testing';

const registryModule: RegistryModuleInterface = {
  async instantiate(_servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    return ConformanceRegistry.bundle();
  },
};

export default registryModule;
