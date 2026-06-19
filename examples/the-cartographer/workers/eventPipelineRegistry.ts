/**
 * eventPipelineRegistry: RegistryModuleInterface for the Cartographer worker pool.
 *
 * DagHost dynamic-imports this compiled file inside each worker thread. It
 * reconstructs the complete event-pipeline-typed bundle — every node and embedded
 * sub-DAG that the enrichment scatter body executes — so the worker runs an
 * identical execution graph to the parent.
 *
 * eventPipelineBundle (from dag.ts) covers:
 *   geo-resolve DAG + nodes (reverseGeocode, routeModalities, ipGeolocate, fuseGeo)
 *   geo-pipeline DAG + nodes (routeGeo, applyGeo, validateCoords)
 *   canonicalize-core nodes (canonicalizeCore, canonicalizeFacility, canonicalizeRecipient)
 *   order-enrichment DAG + nodes (enrichPricing, enrichShipping, enrichEta)
 *   gdpr-compliance DAG + nodes (consentGate, classifyPii, redactPii)
 *   5 per-type pipeline DAGs + their nodes
 *   event-pipeline-typed DAG + routeEventType
 *
 * Services: workers construct CartographerServices locally via GeoResolvers.
 * The parent passes `servicesConfig.useRecordedIp` (boolean) to select the IP
 * backend — 'recorded' (fixture replay, offline) inside workers unless the
 * parent was started with live=true. Workers never share the parent's live
 * HTTP transport; each thread owns its own service instances.
 *
 * This file MUST be compiled to JavaScript before use — workers cannot import
 * .ts files at runtime. Build with:
 *   tsc -p examples/the-cartographer/tsconfig.workers.json
 * The compiled output lands at examples/the-cartographer/dist/workers/eventPipelineRegistry.js.
 */

import type {
  RegistryBundleInterface,
  RegistryModuleInterface,
} from '@studnicky/dagonizer/contracts';
import type { JsonObjectType } from '@studnicky/dagonizer/entities';

import { eventPipelineBundle } from '../dag.js';

// State + services
import { CartographerState } from '../CartographerState.js';
import { GeoResolvers }      from '../services/GeoResolvers.js';

const registry: RegistryModuleInterface = {
  async instantiate(servicesConfig: JsonObjectType): Promise<RegistryBundleInterface> {
    // Reconstruct the services bag in this worker thread.
    // useRecordedIp: true  → deterministic fixture replay (no network)
    // useRecordedIp: false → live freeipapi.com IP geolocation
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
        restore(snapshot: JsonObjectType) {
          return CartographerState.restore(snapshot);
        },
      },
    };
  },
};

export default registry;
