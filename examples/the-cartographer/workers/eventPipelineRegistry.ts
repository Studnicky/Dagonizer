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
import { ParseEventNode }     from '../nodes/parseEvent.js';
import { RouteGeoNode }       from '../nodes/routeGeo.js';
import { ApplyGeoNode }       from '../nodes/applyGeo.js';
import { ValidateCoordsNode } from '../nodes/validateCoords.js';
import { RouteKindNode }      from '../nodes/routeKind.js';
import { ColdChainCheckNode } from '../nodes/coldChainCheck.js';
import { CustomsDwellNode }   from '../nodes/customsDwell.js';
import { EnrichLegNode }      from '../nodes/enrichLeg.js';
import { RouteRedactionNode } from '../nodes/routeRedaction.js';
import { AggregateEventNode } from '../nodes/aggregateEvent.js';

// geo-resolve sub-DAG nodes
import { ReverseGeocodeNode }  from '../nodes/geo/reverseGeocode.js';
import { RouteModalitiesNode } from '../nodes/geo/routeModalities.js';
import { IpGeolocateNode }     from '../nodes/geo/ipGeolocate.js';
import { FuseGeoNode }         from '../nodes/geo/fuseGeo.js';

// canonicalize sub-DAG nodes
import { NormalizeNode } from '../nodes/normalize.js';
import { ClassifyNode }  from '../nodes/classify.js';

// order-enrichment sub-DAG nodes
import { EnrichPricingNode }  from '../nodes/enrichPricing.js';
import { EnrichShippingNode } from '../nodes/enrichShipping.js';
import { EnrichEtaNode }      from '../nodes/enrichEta.js';

// gdpr-compliance sub-DAG nodes
import { ConsentGateNode, ClassifyPiiNode, RedactPiiNode } from '../nodes/gdprNodes.js';

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
          new ParseEventNode(),
          new RouteGeoNode(), new ApplyGeoNode(), new ValidateCoordsNode(),
          new RouteKindNode(), new ColdChainCheckNode(), new CustomsDwellNode(),
          new EnrichLegNode(), new RouteRedactionNode(), new AggregateEventNode(),
          // geo-resolve
          new ReverseGeocodeNode(), new RouteModalitiesNode(), new IpGeolocateNode(), new FuseGeoNode(),
          // canonicalize
          new NormalizeNode(), new ClassifyNode(),
          // order-enrichment
          new EnrichPricingNode(), new EnrichShippingNode(), new EnrichEtaNode(),
          // gdpr-compliance
          new ConsentGateNode(), new ClassifyPiiNode(), new RedactPiiNode(),
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
