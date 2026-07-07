/**
 * cartographerWorkerRegistry: RegistryModuleInterface for the in-browser
 * Cartographer worker pool. Statically imported by cartographerWorkerEntry and
 * injected into the DagHost, so the worker runs no dynamic import. instantiate
 * registers the stream-event body (decode → route → per-type pipelines), the
 * insights-summary body, and a deterministic offline geo services record.
 *
 * geo-source-resolve nodes and DAG are built per-call via GeoSourceResolveDAG.build()
 * so each worker thread owns its own geo service instances with independent
 * transports (no cross-thread resource sharing). Mirrors the pattern in
 * examples/the-cartographer/workers/eventPipelineRegistry.ts.
 */

import type { RegistryBundleInterface, RegistryModuleInterface } from '@studnicky/dagonizer/contracts';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import { CartographerState } from '../../../../examples/the-cartographer/CartographerState.ts';
import { cartographerWorkerRuntimeBundle } from '../../../../examples/the-cartographer/dag.ts';
import { GeoSourceResolveDAG } from '../../../../examples/the-cartographer/embedded-dags/GeoSourceResolveDAG.ts';
import { GeoResolvers } from '../../../../examples/the-cartographer/services/GeoResolvers.ts';

// #region cartographer-worker-registry
const registry: RegistryModuleInterface = {
  async instantiate(servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    const useRecorded = servicesConfig['useRecordedIp'] !== false;
    const services = useRecorded ? GeoResolvers.recorded() : GeoResolvers.live();
    const geoBundle = GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder);
    return {
      'bundle': {
        'nodes': [...geoBundle.nodes, ...cartographerWorkerRuntimeBundle.nodes],
        'dags':  [...geoBundle.dags,  ...cartographerWorkerRuntimeBundle.dags],
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
// #endregion cartographer-worker-registry
