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

function placementIri(dagIri: string, placementIdentifier: string): string {
  return `${dagIri}/node/${placementIdentifier}`;
}

function feedPlacementIri(dagIri: string, source: typeof CARTOGRAPHER_INTAKE_EVENT_TYPES[number]): string {
  return placementIri(dagIri, `dag-feed-${source}`);
}

function eventTypeForFeedPlacement(source: string): typeof CARTOGRAPHER_INTAKE_EVENT_TYPES[number] | null {
  const marker = '/node/dag-feed-';
  const markerIndex = source.lastIndexOf(marker);
  if (markerIndex < 0) return null;

  const label = source.slice(markerIndex + marker.length);
  return CARTOGRAPHER_INTAKE_EVENT_TYPES.find((eventType) => eventType === label) ?? null;
}

function streamFeedDagIri(source: typeof CARTOGRAPHER_INTAKE_EVENT_TYPES[number]): string {
  return `urn:noocodec:dag:cartographer-stream-feed-${source}`;
}

function feedEntrypoints(dagIri: string): Readonly<Record<typeof CARTOGRAPHER_INTAKE_EVENT_TYPES[number], string>> {
  return Object.freeze(
    Object.fromEntries(
      CARTOGRAPHER_INTAKE_EVENT_TYPES.map((source) => [source, feedPlacementIri(dagIri, source)]),
    ),
  ) as Readonly<Record<typeof CARTOGRAPHER_INTAKE_EVENT_TYPES[number], string>>;
}

export const CARTOGRAPHER_IRIS = Object.freeze({
  dag: CARTOGRAPHER_DAG_IRIS,
  intakeEventTypes: CARTOGRAPHER_INTAKE_EVENT_TYPES,
  eventTypeForFeedPlacement,
  streamFeedDagIri,
  feedEntrypoints,
  feedPlacementIri,
  placementIri,
});
