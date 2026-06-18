/**
 * cartographerWorkerRegistry: RegistryModuleInterface for the in-browser
 * Cartographer worker pool. Statically imported by cartographerWorkerEntry and
 * injected into the DagHost, so the worker runs no dynamic import. instantiate
 * registers the stream-event body (decode → route → per-type pipelines) and a
 * deterministic offline geo services bag.
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObject } from '@studnicky/dagonizer/entities';

import { CartographerState } from '../../../../examples/the-cartographer/CartographerState.ts';
import { eventPipelineBundle } from '../../../../examples/the-cartographer/dag.ts';
import { GeoResolvers } from '../../../../examples/the-cartographer/services/GeoResolvers.ts';

const registry: RegistryModuleInterface = {
  async instantiate(servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    const useRecorded = servicesConfig['useRecordedIp'] !== false;
    const services = useRecorded ? GeoResolvers.recorded() : GeoResolvers.live();
    return {
      'bundle': {
        'nodes': eventPipelineBundle.nodes,
        'dags':  eventPipelineBundle.dags,
      },
      'services':        services,
      'registryVersion': '1.0.0',
      'restoreState': {
        restore(snapshot: JsonObject) {
          return CartographerState.restore(snapshot);
        },
      },
    };
  },
};

export default registry;
