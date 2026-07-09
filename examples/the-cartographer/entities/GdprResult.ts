/**
 * GdprResult: the outcome of the location-driven GDPR compliance sub-pipeline.
 *
 * Redaction strictness is `max(jurisdiction baseline, consent-implied)`:
 *   - GDPR / UK-GDPR / LGPD → strict (irreversible unless valid consent),
 *   - CCPA → moderate, baseline → light.
 * Retention follows jurisdiction × consent. `coordsCoarsened` records whether
 * the scan's precise lat/lng were coarsened to a grid-zone centroid (when the
 * jurisdiction is strict OR consent is missing/expired — location is PII).
 *
 * The lawful basis for processing a *delivery* is the contract — a shipment is
 * always processed regardless of marketing consent. The only drop is the rare
 * special-category-without-lawful-basis violation. complianceScore is reported,
 * not gating.
 */

// #region gdpr-result-entity
import type { FromSchema } from 'json-schema-to-ts';

export const GdprResultSchema = {
  '$id': 'https://noocodec.dev/schemas/cartographer/GdprResult',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': [
    'personalDataFields', 'sensitiveDataFields', 'consentStatus',
    'lawfulBasis', 'jurisdiction', 'strictness', 'complianceScore',
    'retention', 'redactionApplied', 'marketingAnalyticsEligible',
    'coordsCoarsened',
  ],
  'properties': {
    'personalDataFields':  { 'type': 'array', 'items': { 'type': 'string' } },
    'sensitiveDataFields': { 'type': 'array', 'items': { 'type': 'string' } },
    'consentStatus': { 'type': 'string', 'enum': ['valid', 'missing', 'expired'] },
    'lawfulBasis': { 'type': 'string', 'enum': ['contract', 'consent', 'legitimate-interest', 'none'] },
    'jurisdiction': { 'type': 'string', 'enum': ['GDPR', 'UK-GDPR', 'CCPA', 'LGPD', 'APPI', 'baseline', 'international-waters'] },
    'strictness': { 'type': 'string', 'enum': ['strict', 'moderate', 'light'] },
    'complianceScore': { 'type': 'number', 'minimum': 0, 'maximum': 100 },
    'retention': {
      'type': 'object',
      'required': ['retainUntil', 'autoDelete'],
      'properties': {
        'retainUntil': { 'type': 'string', 'minLength': 1 },
        'autoDelete':  { 'type': 'boolean' },
      },
      'additionalProperties': false,
    },
    'redactionApplied': { 'type': 'boolean' },
    'marketingAnalyticsEligible': { 'type': 'boolean' },
    'coordsCoarsened': { 'type': 'boolean' },
  },
  'additionalProperties': false,
} as const;

export type GdprResult = FromSchema<typeof GdprResultSchema>;
// #endregion gdpr-result-entity
