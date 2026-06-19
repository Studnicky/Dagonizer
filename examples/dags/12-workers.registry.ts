/**
 * 12-workers.registry: RegistryModuleInterface default export.
 *
 * The WorkerThreadContainer dynamic-imports this compiled file (the .js
 * build output under examples/dist/) inside each worker thread. DagHost
 * calls `registry.instantiate(servicesConfig)` to reconstruct the same
 * bundle of nodes and DAGs that the parent dispatcher uses, ensuring the
 * worker runs an identical execution graph.
 *
 * The `restoreState` function lets DagHost rehydrate a WorkState instance
 * from the serialized snapshot sent through the bridge protocol.
 *
 * This file MUST be compiled to JavaScript before use — workers cannot
 * import .ts files at runtime. Build with:
 *   tsc -p examples/tsconfig.workers.json
 * The compiled output lands at examples/dist/dags/12-workers.registry.js.
 */

// #region registry
import type { RegistryBundleInterface, RegistryModuleInterface } from '@studnicky/dagonizer/contracts';
import { CheckpointRestoreAdapterFn } from '@studnicky/dagonizer/checkpoint';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import { dag, SquareWorkerNode, workerDag, WorkState } from './12-workers.js';

const registry: RegistryModuleInterface = {
  async instantiate(_servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    return {
      "bundle": {
        "nodes": [new SquareWorkerNode()],
        "dags":  [workerDag, dag],
      },
      "services":        undefined,
      "registryVersion": '1.0.0',
      "restoreState":    CheckpointRestoreAdapterFn.wrap((snapshot: JsonObjectType) => WorkState.restore(snapshot)),
    };
  },
};

export default registry;
// #endregion registry
