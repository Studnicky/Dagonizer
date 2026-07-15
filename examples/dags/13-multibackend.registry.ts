/**
 * 13-multibackend.registry: RegistryModuleInterface default export.
 *
 * WorkerThreadContainer and ForkContainer dynamic-import this compiled file
 * inside each worker / forked process. DagHost calls `registry.instantiate`
 * to reconstruct the same bundle of nodes and DAGs used by the parent.
 *
 * This file MUST be compiled to JavaScript before use — workers cannot
 * import .ts files at runtime. Build with:
 *   tsc -p examples/tsconfig.multibackend.json
 * The compiled output lands at examples/dist/dags/13-multibackend.registry.js.
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@studnicky/dagonizer/contracts';
import { CheckpointRestoreAdapter } from '@studnicky/dagonizer/checkpoint';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import { dag, squareItemDag, SquareNode, SumNode, sumResultsDag, MultiBackendState } from './13-multibackend.js';

const registry: RegistryModuleInterface = {
  async instantiate(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    return {
      "bundle": {
        "nodes": [new SquareNode(), new SumNode()],
        "dags":  [squareItemDag, sumResultsDag, dag],
      },
      "registryVersion": '1.0.0',
      "restoreState":    CheckpointRestoreAdapter.wrap(() => new MultiBackendState()),
    };
  },
};

export default registry;
