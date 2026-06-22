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
import { Consent, GdprRedactor, GeoCoarsener, Jurisdictions } from '../services.ts';

import { NodeOutputBuilder, type NodeContextType, type NodeOutputType,
  ScalarNode,
} from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';

// #region gdpr-nodes

export class ConsentGateNode extends ScalarNode<CartographerState, 'classify'> {
  readonly 'name' = 'consent-gate';
  readonly 'outputs' = ['classify'] as const;

  override get outputSchema(): Record<'classify', SchemaObjectType> {
    return {
      'classify': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'classify'>> {
    // Resolve marketing consent (10% of consented treated as lapsed/expired).
    const consentStatus = Consent.statusFor(state.currentEvent.shipmentId, state.currentEvent.marketingConsent);
    state.gdprResult = {
      ...state.gdprResult,
      'consentStatus': consentStatus,
      'lawfulBasis':   state.raw.lawfulBasis,
      'jurisdiction':  state.geoContext.jurisdiction,
    };
    return NodeOutputBuilder.of('classify');
  }
}

export class ClassifyPiiNode extends ScalarNode<CartographerState, 'redact'> {
  readonly 'name' = 'classify-pii';
  readonly 'outputs' = ['redact'] as const;

  override get outputSchema(): Record<'redact', SchemaObjectType> {
    return {
      'redact': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'redact'>> {
    const classification = GdprRedactor.classify(state.currentEvent);
    state.gdprResult = {
      ...state.gdprResult,
      'personalDataFields':  classification.personalDataFields,
      'sensitiveDataFields': classification.sensitiveDataFields,
    };
    return NodeOutputBuilder.of('redact');
  }
}

export class RedactPiiNode extends ScalarNode<CartographerState, 'ok' | 'violation'> {
  readonly 'name' = 'redact-pii';
  readonly 'outputs' = ['ok', 'violation'] as const;

  override get outputSchema(): Record<'ok' | 'violation', SchemaObjectType> {
    return {
      'ok':        { 'type': 'object' },
      'violation': { 'type': 'object' },
    };
  }

  protected override async executeOne(state: CartographerState, _context: NodeContextType): Promise<NodeOutputType<'ok' | 'violation'>> {
    // Genuine violation: special-category data with no lawful basis (rare drop).
    if (!GdprRedactor.hasLawfulBasis(state.raw.lawfulBasis, state.raw.specialCategory)) {
      return NodeOutputBuilder.of('violation');
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
    return NodeOutputBuilder.of('ok');
  }
}
// #endregion gdpr-nodes

export const consentGate = new ConsentGateNode();
export const classifyPii = new ClassifyPiiNode();
export const redactPii = new RedactPiiNode();
