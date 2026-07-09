/**
 * Well-formedness validation: check all three Cartographer DAGs.
 *
 * `WellFormedValidator.check` returns an array of human-readable strings;
 * an empty array means the DAG is well-formed.
 */

// #region well-formed-validate
import { WellFormedValidator } from '@studnicky/dagonizer/validation';

import { cartographerDAG, eventPipelineTypedDAG } from './dag.ts';
import { gdprComplianceDAG } from './embedded-dags/GdprComplianceDAG.ts';
import { GeoSourceResolveDAG } from './embedded-dags/GeoSourceResolveDAG.ts';
import { ingestSourceDAG } from './embedded-dags/IngestSourceDAG.ts';
import { orderEnrichmentDAG } from './embedded-dags/OrderEnrichmentDAG.ts';
import { geoPipelineDAG } from './embedded-dags/GeoPipelineDAG.ts';
import { pipelinePositionPingDAG } from './embedded-dags/PipelinePositionPingDAG.ts';
import { pipelineSensorReadingDAG } from './embedded-dags/PipelineSensorReadingDAG.ts';
import { pipelineCustomsEventDAG } from './embedded-dags/PipelineCustomsEventDAG.ts';
import { pipelineFacilityScanDAG } from './embedded-dags/PipelineFacilityScanDAG.ts';
import { pipelineDeliveryConfirmationDAG } from './embedded-dags/PipelineDeliveryConfirmationDAG.ts';
import { producerFeedDAGs } from './embedded-dags/ProducerFeedDAG.ts';
import { GeoResolvers } from './services/GeoResolvers.ts';

// Build the geo-source-resolve DAG with recorded (offline) resolvers for validation.
const geoServices = GeoResolvers.recorded();
const geoSourceResolveBundle = GeoSourceResolveDAG.build(geoServices.ipGeolocator, geoServices.addressGeocoder);
const geoSourceResolveDAG = geoSourceResolveBundle.dags[0];

const dags = [
  { 'label': 'cartographer',      'dag': cartographerDAG },
  ...producerFeedDAGs.map((dag) => ({ 'label': dag.name, 'dag': dag })),
  { 'label': 'ingest-source',     'dag': ingestSourceDAG },
  { 'label': 'geo-source-resolve', 'dag': geoSourceResolveDAG },
  { 'label': 'order-enrichment',  'dag': orderEnrichmentDAG },
  { 'label': 'gdpr-compliance',   'dag': gdprComplianceDAG },
  // Wave 4-5: per-type processing layer.
  { 'label': 'event-pipeline-typed',            'dag': eventPipelineTypedDAG },
  { 'label': 'geo-pipeline',                    'dag': geoPipelineDAG },
  { 'label': 'pipeline-position-ping',          'dag': pipelinePositionPingDAG },
  { 'label': 'pipeline-sensor-reading',         'dag': pipelineSensorReadingDAG },
  { 'label': 'pipeline-customs-event',          'dag': pipelineCustomsEventDAG },
  { 'label': 'pipeline-facility-scan',          'dag': pipelineFacilityScanDAG },
  { 'label': 'pipeline-delivery-confirmation',  'dag': pipelineDeliveryConfirmationDAG },
] as const;

let anyViolation = false;
for (const { label, dag } of dags) {
  if (dag === undefined) {
    console.log(`dag-validate [${label}]: skipped (undefined)`);
    continue;
  }
  const violations = WellFormedValidator.check(dag);
  if (violations.length === 0) {
    console.log(`dag-validate [${label}]: well-formed`);
  } else {
    anyViolation = true;
    console.log(`dag-validate [${label}]: ${violations.length} violation(s)`);
    for (const v of violations) {
      console.log(`  - ${v}`);
    }
  }
}
if (anyViolation) process.exit(1);
// #endregion well-formed-validate
