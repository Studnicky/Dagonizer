/**
 * eventPipelineRegistry: RegistryModuleInterface for the Cartographer worker pool.
 *
 * DagHost dynamic-imports this compiled file inside each worker thread. It
 * reconstructs the complete event-pipeline bundle — every node and embedded
 * sub-DAG that the enrichment scatter body executes — so the worker runs an
 * identical execution graph to the parent.
 *
 * Bundle coverage (what the event-pipeline sub-DAG needs):
 *   Parent nodes:   parse, routeGeo, applyGeo, validateCoords, routeKind,
 *                   coldChainCheck, customsDwell, enrichLeg, routeRedaction,
 *                   aggregateEvent
 *   Embedded DAGs:  geo-resolve (reverseGeocode, routeModalities, ipGeolocate, fuseGeo)
 *                   canonicalize (normalize, classify)
 *                   order-enrichment (enrichPricing, enrichShipping, enrichEta)
 *                   gdpr-compliance (consentGate, classifyPii, redactPii)
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
} from '@noocodex/dagonizer/contracts';
import type { JsonObject } from '@noocodex/dagonizer/entities';

// Parent-level event-pipeline nodes (registered in the worker dispatcher)
import { parseEvent }     from '../nodes/parseEvent.js';
import { routeGeo }       from '../nodes/routeGeo.js';
import { applyGeo }       from '../nodes/applyGeo.js';
import { validateCoords } from '../nodes/validateCoords.js';
import { routeKind }      from '../nodes/routeKind.js';
import { coldChainCheck } from '../nodes/coldChainCheck.js';
import { customsDwell }   from '../nodes/customsDwell.js';
import { enrichLeg }      from '../nodes/enrichLeg.js';
import { routeRedaction } from '../nodes/routeRedaction.js';
import { aggregateEvent } from '../nodes/aggregateEvent.js';

// geo-resolve sub-DAG nodes
import { reverseGeocode }  from '../nodes/geo/reverseGeocode.js';
import { routeModalities } from '../nodes/geo/routeModalities.js';
import { ipGeolocate }     from '../nodes/geo/ipGeolocate.js';
import { fuseGeo }         from '../nodes/geo/fuseGeo.js';

// canonicalize sub-DAG nodes
import { normalize } from '../nodes/normalize.js';
import { classify }  from '../nodes/classify.js';

// order-enrichment sub-DAG nodes
import { enrichPricing }  from '../nodes/enrichPricing.js';
import { enrichShipping } from '../nodes/enrichShipping.js';
import { enrichEta }      from '../nodes/enrichEta.js';

// gdpr-compliance sub-DAG nodes
import { consentGate, classifyPii, redactPii } from '../nodes/gdprNodes.js';

// DAG definitions (event-pipeline + all embedded sub-DAGs)
import { eventPipelineDAG } from '../dag.js';
import { geoResolveDAG }         from '../embedded-dags/GeoResolveDAG.js';
import { canonicalizeDAG }       from '../embedded-dags/CanonicalizeDAG.js';
import { orderEnrichmentDAG }    from '../embedded-dags/OrderEnrichmentDAG.js';
import { gdprComplianceDAG }     from '../embedded-dags/GdprComplianceDAG.js';

// State + services
import { CartographerState } from '../CartographerState.js';
import { GeoResolvers }      from '../services/GeoResolvers.js';

const registry: RegistryModuleInterface = {
  async createBundle(servicesConfig: JsonObject): Promise<RegistryBundleInterface> {
    // Reconstruct the services bag in this worker thread.
    // useRecordedIp: true  → deterministic fixture replay (no network)
    // useRecordedIp: false → live freeipapi.com IP geolocation
    const useRecorded = servicesConfig['useRecordedIp'] !== false;
    const services = useRecorded ? GeoResolvers.recorded() : GeoResolvers.live();

    return {
      'bundle': {
        'nodes': [
          // event-pipeline parent nodes
          parseEvent,
          routeGeo, applyGeo, validateCoords,
          routeKind, coldChainCheck, customsDwell,
          enrichLeg, routeRedaction, aggregateEvent,
          // geo-resolve
          reverseGeocode, routeModalities, ipGeolocate, fuseGeo,
          // canonicalize
          normalize, classify,
          // order-enrichment
          enrichPricing, enrichShipping, enrichEta,
          // gdpr-compliance
          consentGate, classifyPii, redactPii,
        ],
        'dags': [
          // Embedded sub-DAGs must be registered before the parent.
          geoResolveDAG,
          canonicalizeDAG,
          orderEnrichmentDAG,
          gdprComplianceDAG,
          // The scatter body: the parent runs this per canonical event.
          eventPipelineDAG,
        ],
      },
      'services':        services,
      'registryVersion': '1.0.0',
      restoreState(snapshot: JsonObject) {
        return CartographerState.restore(snapshot);
      },
    };
  },
};

export default registry;
