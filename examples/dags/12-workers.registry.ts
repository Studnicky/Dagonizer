/**
 * 12-workers.registry: RegistryModuleInterface default export.
 *
 * The WorkerThreadContainer dynamic-imports this compiled file (the .js
 * build output under examples/dist/) inside each worker thread. DagHost
 * calls `registry.createBundle(servicesConfig)` to reconstruct the same
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

import type { RegistryBundleInterface, RegistryModuleInterface } from '@noocodex/dagonizer/contracts';
import { CheckpointRestoreAdapterFn } from '@noocodex/dagonizer/checkpoint';
import type { JsonObject } from '@noocodex/dagonizer/entities';

import { dag, SquareWorkerNode, workerDag, WorkState } from './12-workers.js';

const registry: RegistryModuleInterface = {
  async createBundle(_servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    return {
      "bundle": {
        "nodes": [new SquareWorkerNode()],
        "dags":  [workerDag, dag],
      },
      "services":        undefined,
      "registryVersion": '1.0.0',
      "restoreState":    CheckpointRestoreAdapterFn.fromFn((snapshot: JsonObject) => WorkState.restore(snapshot)),
    };
  },
};

export default registry;
