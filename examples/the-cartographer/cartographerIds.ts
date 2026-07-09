import { DAGIdentity } from '@studnicky/dagonizer';

const CARTOGRAPHER_INTAKE_EVENT_TYPES = [
  'position-ping',
  'facility-scan',
  'sensor-reading',
  'customs-event',
  'delivery-confirmation',
] as const;

const CARTOGRAPHER_DAG_IRIS = Object.freeze({
  cartographer: 'urn:noocodec:dag:cartographer',
  cartographerResume: 'urn:noocodec:dag:cartographer-resume',
  insightsSummary: 'urn:noocodec:dag:insights-summary',
  eventPipelineTyped: 'urn:noocodec:dag:event-pipeline-typed',
  streamEvent: 'urn:noocodec:dag:stream-event',
  geoPipeline: 'urn:noocodec:dag:geo-pipeline',
  geoSourceResolve: 'urn:noocodec:dag:geo-source-resolve',
  geoResolveCoords: 'urn:noocodec:dag:geo-resolve-coords',
  geoResolveAddress: 'urn:noocodec:dag:geo-resolve-address',
  geoResolveIp: 'urn:noocodec:dag:geo-resolve-ip',
  geoResolveCode: 'urn:noocodec:dag:geo-resolve-code',
  geoResolvePhone: 'urn:noocodec:dag:geo-resolve-phone',
  geoResolveLocale: 'urn:noocodec:dag:geo-resolve-locale',
  orderEnrichment: 'urn:noocodec:dag:order-enrichment',
  gdprCompliance: 'urn:noocodec:dag:gdpr-compliance',
  pipelinePositionPing: 'urn:noocodec:dag:pipeline-position-ping',
  pipelineSensorReading: 'urn:noocodec:dag:pipeline-sensor-reading',
  pipelineCustomsEvent: 'urn:noocodec:dag:pipeline-customs-event',
  pipelineFacilityScan: 'urn:noocodec:dag:pipeline-facility-scan',
  pipelineDeliveryConfirmation: 'urn:noocodec:dag:pipeline-delivery-confirmation',
  normalizeCsv: 'urn:noocodec:dag:normalize-csv',
  normalizeJson: 'urn:noocodec:dag:normalize-json',
  normalizeNdjson: 'urn:noocodec:dag:normalize-ndjson',
  normalizeYaml: 'urn:noocodec:dag:normalize-yaml',
  ingestSource: 'urn:noocodec:dag:ingest-source',
} as const);

function entrypointIri(dagIri: string, label: string): string {
  return `${DAGIdentity.id(dagIri)}/entrypoint/${encodeURIComponent(label)}`;
}

function placementIri(dagIri: string, placementIdentifier: string): string {
  return DAGIdentity.placementId(dagIri, placementIdentifier);
}

function intakeSources(dagIri: string): Readonly<Record<string, object>> {
  return Object.freeze(
    Object.fromEntries(
      CARTOGRAPHER_INTAKE_EVENT_TYPES.map((source) => [entrypointIri(dagIri, source), {}]),
    ),
  ) as Readonly<Record<string, object>>;
}

export const CARTOGRAPHER_IRIS = Object.freeze({
  dag: CARTOGRAPHER_DAG_IRIS,
  intakeEventTypes: CARTOGRAPHER_INTAKE_EVENT_TYPES,
  entrypointIri,
  intakeSources,
  placementIri,
});
