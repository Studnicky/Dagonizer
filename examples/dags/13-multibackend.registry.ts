/**
 * 13-multibackend.registry: RegistryModuleInterface default export.
 *
 * WorkerThreadContainer and ForkContainer dynamic-import this compiled file
 * inside each worker / forked process. DagHost calls `registry.createBundle`
 * to reconstruct the same bundle of nodes and DAGs used by the parent.
 *
 * This file MUST be compiled to JavaScript before use — workers cannot
 * import .ts files at runtime. Build with:
 *   tsc -p examples/tsconfig.multibackend.json
 * The compiled output lands at examples/dist/dags/13-multibackend.registry.js.
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';

import { dag, squareItemDag, squareNode, sumNode, sumResultsDag, MultiBackendState } from './13-multibackend.js';

const registry: RegistryModuleInterface = {
  async createBundle(_servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    return {
      "bundle": {
        "nodes": [squareNode, sumNode],
        "dags":  [squareItemDag, sumResultsDag, dag],
      },
      "services":        undefined,
      "registryVersion": '1.0.0',
      restoreState(snapshot: JsonObject) {
        return MultiBackendState.restore(snapshot);
      },
    };
  },
};

export default registry;
