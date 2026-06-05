/**
 * GDPR compliance nodes for the gdpr-compliance embedded DAG (location-driven).
 *
 * consent-gate  — resolves marketing consentStatus, lawfulBasis, and the scan's
 *                 jurisdiction (from geo-context).
 * classify-pii  — records personal/sensitive field lists (incl. scanCoords).
 * redact-pii    — strictness = max(jurisdiction baseline, consent-implied);
 *                 irreversible redaction + coords coarsening when strict or
 *                 consent not valid; routes 'violation' ONLY for special-category
 *                 data with no lawful basis (rare).
 *
 * Lack of marketing consent never drops a shipment. Location is PII: precise
 * scan coords are coarsened to a grid-zone centroid under strict regimes.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { Consent, GdprRedactor, GeoCoarsener, Jurisdictions } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

// #region gdpr-nodes

export const consentGate: NodeInterface<CartographerState, 'classify', CartographerServices> = {
  'name': 'consent-gate',
  'outputs': ['classify'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    // Resolve marketing consent (10% of consented treated as lapsed/expired).
    const consentStatus = Consent.statusFor(state.currentEvent.shipmentId, state.currentEvent.marketingConsent);
    state.gdprResult = {
      ...state.gdprResult,
      'consentStatus': consentStatus,
      'lawfulBasis':   state.raw.lawfulBasis,
      'jurisdiction':  state.geoContext.jurisdiction,
    };
    return { 'output': 'classify' };
  },
};

export const classifyPii: NodeInterface<CartographerState, 'redact', CartographerServices> = {
  'name': 'classify-pii',
  'outputs': ['redact'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const classification = GdprRedactor.classify(state.currentEvent);
    state.gdprResult = {
      ...state.gdprResult,
      'personalDataFields':  classification.personalDataFields,
      'sensitiveDataFields': classification.sensitiveDataFields,
    };
    return { 'output': 'redact' };
  },
};

export const redactPii: NodeInterface<CartographerState, 'ok' | 'violation', CartographerServices> = {
  'name': 'redact-pii',
  'outputs': ['ok', 'violation'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    // Genuine violation: special-category data with no lawful basis (rare drop).
    if (!GdprRedactor.hasLawfulBasis(state.raw.lawfulBasis, state.raw.specialCategory)) {
      return { 'output': 'violation' };
    }

    const juris = Jurisdictions.forCountry(state.geoContext.country);
    const { redacted, result } = await GdprRedactor.redact(
      state.currentEvent,
      state.gdprResult.consentStatus,
      state.raw.lawfulBasis,
      state.geoContext.jurisdiction,
      juris.strictness,
      juris.baseRetentionDays,
    );

    // Apply field redaction to currentEvent (the clone owns this scan).
    state.currentEvent = {
      ...state.currentEvent,
      'recipientName':    redacted.recipientName    ?? state.currentEvent.recipientName,
      'recipientEmail':   redacted.recipientEmail   ?? state.currentEvent.recipientEmail,
      'recipientPhone':   redacted.recipientPhone   ?? state.currentEvent.recipientPhone,
      'recipientAddress': redacted.recipientAddress ?? state.currentEvent.recipientAddress,
    };

    // Location-as-PII: coarsen the scan coords in-place when required.
    if (result.coordsCoarsened) {
      const centroid = GeoCoarsener.toCentroid(state.currentEvent.latitude, state.currentEvent.longitude);
      state.currentEvent = {
        ...state.currentEvent,
        'latitude':  centroid.lat,
        'longitude': centroid.lng,
      };
    }

    state.gdprResult = result;
    return { 'output': 'ok' };
  },
};
// #endregion gdpr-nodes
