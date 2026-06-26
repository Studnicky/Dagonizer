/**
 * EnrichedShipment: the compact per-SCAN denormalized record written by `aggregate-event`.
 *
 * Each clone of `shipment-pipeline` processes one tracking scan and writes one
 * EnrichedShipment onto `state.enriched`. The parent gathers these into
 * `state.records`. `summarizeInsights` folds them into TWO views: per-region
 * and per-journey (grouped by shipmentId, ordered by epochMs).
 *
 * Journey/movement fields per scan: `scanSeq`, `epochMs`, `localIso`,
 * `utcOffset`, `timezone`, `jurisdiction`, `legKm`. Shipment-level fields
 * (pricing/shipping/eta) are identical across a journey's scans; the journey
 * summary takes them once.
 *
 * Location-as-PII: `lat`/`lng` are the STORED coords — coarsened to a grid-zone
 * centroid when `coordsCoarsened` is true (strict jurisdiction OR consent not
 * valid). The redactedSample captures the before→after of the three PII fields.
 * Money fields are integer minor units (USD cents), FX-normalised.
 *
 * `routing` records THIS scan's conditional-routing decisions (the headline): the
 * branching DAG routes each event only through the nodes it needs, and each clone
 * records what RAN vs was SKIPPED on its own record (no shared mutable counters
 * across scatter clones). The parent's summarize folds these into the savings
 * totals. `path` is the per-event-type enrichment lane the event took.
 */

// #region enriched-shipment-entity
import type { FromSchema } from 'json-schema-to-ts';

export const EnrichedShipmentSchema = {
  '$id': 'https://noocodex.dev/schemas/cartographer/EnrichedShipment',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': [
    'shipmentId', 'scanSeq', 'epochMs', 'localIso', 'utcOffset', 'timezone', 'jurisdiction',
    'continent', 'region', 'country', 'hub', 'geoStatus',
    'lat', 'lng', 'coordsCoarsened', 'legKm',
    'status', 'serviceTier', 'sizeTier',
    'onTime', 'exception', 'consentStatus', 'disruptionReason',
    'subtotalUsdMinor', 'currency',
    'shippingUsdMinor', 'distanceKm',
    'transitHours', 'delayHours',
    'redactionApplied', 'redactedSample', 'routing',
  ],
  'properties': {
    'shipmentId':        { 'type': 'string', 'minLength': 1 },
    'scanSeq':           { 'type': 'number', 'minimum': 0 },
    'epochMs':           { 'type': 'number' },
    'localIso':          { 'type': 'string' },
    'utcOffset':         { 'type': 'string' },
    'timezone':          { 'type': 'string' },
    'jurisdiction':      { 'type': 'string', 'enum': ['GDPR', 'UK-GDPR', 'CCPA', 'LGPD', 'APPI', 'baseline', 'international-waters'] },
    // Macro continent (from a real API) — the per-region insights table buckets by this.
    'continent':         { 'type': 'string', 'minLength': 1 },
    'region':            { 'type': 'string', 'minLength': 1 },
    'country':           { 'type': 'string', 'minLength': 1 },
    'hub':               { 'type': 'string', 'minLength': 1 },
    'geoStatus':         { 'type': 'string', 'enum': ['land', 'water', 'coastal', 'unmapped'] },
    'lat':               { 'type': 'number' },
    'lng':               { 'type': 'number' },
    'coordsCoarsened':   { 'type': 'boolean' },
    'legKm':             { 'type': 'number', 'minimum': 0 },
    'status':            { 'type': 'string', 'enum': ['SCAN', 'DEPARTURE', 'ARRIVAL', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'] },
    'serviceTier':       { 'type': 'string', 'enum': ['express', 'standard', 'economy'] },
    'sizeTier':          { 'type': 'string', 'enum': ['envelope', 'small', 'medium', 'large', 'freight'] },
    'onTime':            { 'type': 'boolean' },
    'exception':         { 'type': 'boolean' },
    'consentStatus':     { 'type': 'string', 'enum': ['valid', 'missing', 'expired'] },
    'disruptionReason':  { 'type': 'string' },
    'subtotalUsdMinor':  { 'type': 'number', 'minimum': 0 },
    'currency':          { 'type': 'string', 'minLength': 3, 'maxLength': 3 },
    'shippingUsdMinor':  { 'type': 'number', 'minimum': 0 },
    'distanceKm':        { 'type': 'number', 'minimum': 0 },
    'transitHours':      { 'type': 'number', 'minimum': 0 },
    'delayHours':        { 'type': 'number', 'minimum': 0 },
    'redactionApplied':  { 'type': 'boolean' },
    'redactedSample': {
      'type': 'object',
      'required': ['recipientName', 'recipientEmail', 'recipientPhone'],
      'properties': {
        'recipientName':  { 'type': 'string' },
        'recipientEmail': { 'type': 'string' },
        'recipientPhone': { 'type': 'string' },
      },
      'additionalProperties': false,
    },
    // This scan's conditional-routing decisions (RAN vs SKIPPED per branch),
    // including REAL geo-API call accounting (reverse-geocode + ip-geolocate).
    'routing': {
      'type': 'object',
      'required': [
        'path',
        'geoLookupRun', 'geoLookupSkipped',
        'ipGeolocateRun', 'ipGeolocateSkipped',
        'geoConfidence', 'geoModalities',
        'geoSourceModel', 'geoFallbackUsed',
        'redactionRun', 'redactionSkipped',
        'pricingRun', 'pricingSkipped',
        'etaRun', 'etaSkipped',
        'coldChainRun', 'customsDwellRun',
      ],
      'properties': {
        // The per-event-type enrichment lane this event took.
        'path':              { 'type': 'string', 'enum': ['geo-only', 'sensor', 'order', 'customs'] },
        // Whether the whole geo-resolve sub-DAG (real API calls) ran or was skipped.
        'geoLookupRun':      { 'type': 'boolean' },
        'geoLookupSkipped':  { 'type': 'boolean' },
        // Real API-call accounting inside geo-resolve.
        'ipGeolocateRun':    { 'type': 'boolean' },
        'ipGeolocateSkipped': { 'type': 'boolean' },
        // Multi-modal fusion outcome carried for the report.
        'geoConfidence':     { 'type': 'number', 'minimum': 0, 'maximum': 1 },
        'geoModalities':     { 'type': 'array', 'items': { 'type': 'string' } },
        // Source-model classification: which geo signal classify-geo-source selected.
        'geoSourceModel':    { 'type': 'string' },
        // Whether resolve-coords-fallback fired (CoordTimezone secondary lookup).
        'geoFallbackUsed':   { 'type': 'boolean' },
        'redactionRun':      { 'type': 'boolean' },
        'redactionSkipped':  { 'type': 'boolean' },
        'pricingRun':        { 'type': 'boolean' },
        'pricingSkipped':    { 'type': 'boolean' },
        'etaRun':            { 'type': 'boolean' },
        'etaSkipped':        { 'type': 'boolean' },
        'coldChainRun':      { 'type': 'boolean' },
        'customsDwellRun':   { 'type': 'boolean' },
      },
      'additionalProperties': false,
    },
  },
  'additionalProperties': false,
} as const;

export type EnrichedShipment = FromSchema<typeof EnrichedShipmentSchema>;

export class EnrichedShipmentGuard {
  /**
   * Type-guard for EnrichedShipment. Narrows `unknown` to the schema-derived type
   * by verifying required fields that consumers rely on after narrowing.
   */
  static is(value: unknown): value is EnrichedShipment {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    if (!('shipmentId' in value) || typeof value.shipmentId !== 'string' || value.shipmentId.length === 0) return false;
    if (!('routing' in value) || typeof value.routing !== 'object' || value.routing === null) return false;
    return true;
  }
}
// #endregion enriched-shipment-entity
