/**
 * Conformance registry fixture for dagonizer-executor-node tests.
 *
 * Constructs a RegistryModuleInterface implementation using buildConformanceBundle
 * from @noocodex/dagonizer/testing and exports it as the module default so that
 * DagHost can dynamic-import this compiled file to reconstruct the conformance
 * bundle inside an isolate.
 *
 * W3 consumer pattern documented in ConformanceRegistry.ts:
 *   "W3 consumers: downstream packages re-export this module's default from a
 *   local fixture file in their own test tree to obtain an importable module URL"
 *
 * Usage from dist-test/tests/unit/conformance.test.js:
 *   new URL('./fixtures/registry.js', import.meta.url).href
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';
import { buildConformanceBundle } from '@noocodex/dagonizer/testing';

const registry: RegistryModuleInterface = {
  async createBundle(_servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    return buildConformanceBundle();
  },
};

export default registry;
