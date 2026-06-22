/**
 * cartographerWorkerRegistry: RegistryModuleInterface for the in-browser
 * Cartographer worker pool. Statically imported by cartographerWorkerEntry and
 * injected into the DagHost, so the worker runs no dynamic import. instantiate
 * registers the stream-event body (decode → route → per-type pipelines) and a
 * deterministic offline geo services record.
 *
 * geo-resolve nodes and DAG are built per-call via GeoResolveDAG.build() so
 * each worker thread owns its own geo service instances with independent
 * transports (no cross-thread resource sharing). Mirrors the pattern in
 * examples/the-cartographer/workers/eventPipelineRegistry.ts.
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import { CartographerState } from '../../../../examples/the-cartographer/CartographerState.ts';
import { eventPipelineBundle } from '../../../../examples/the-cartographer/dag.ts';
import { GeoResolveDAG } from '../../../../examples/the-cartographer/embedded-dags/GeoResolveDAG.ts';
import { GeoResolvers } from '../../../../examples/the-cartographer/services/GeoResolvers.ts';

const registry: RegistryModuleInterface = {
  async instantiate(servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    const useRecorded = servicesConfig['useRecordedIp'] !== false;
    const services = useRecorded ? GeoResolvers.recorded() : GeoResolvers.live();
    const geoBundle = GeoResolveDAG.build(services.reverseGeocoder, services.ipGeolocator);
    return {
      'bundle': {
        'nodes': [...geoBundle.nodes, ...eventPipelineBundle.nodes],
        'dags':  [...geoBundle.dags,  ...eventPipelineBundle.dags],
      },
      'registryVersion': '1.0.0',
      'restoreState': {
        restore(snapshot: JsonObjectType) {
          return CartographerState.restore(snapshot);
        },
      },
    };
  },
};

export default registry;
