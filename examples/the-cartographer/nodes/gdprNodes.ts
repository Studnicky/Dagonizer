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

import { Batch, MonadicNode, NodeOutput, RoutedBatch } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region gdpr-nodes

export class ConsentGateNode extends MonadicNode<CartographerState, 'classify'> {
  readonly 'name' = 'consent-gate';
  readonly 'outputs' = ['classify'] as const;

  override get outputSchema(): Record<'classify', SchemaObjectType> {
    return {
      'classify': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'classify', CartographerState>> {
    for (const item of batch) {
      // Resolve marketing consent (10% of consented treated as lapsed/expired).
      const consentStatus = Consent.statusFor(item.state.currentEvent.shipmentId, item.state.currentEvent.marketingConsent);
      item.state.gdprResult = {
        ...item.state.gdprResult,
        'consentStatus': consentStatus,
        'lawfulBasis':   item.state.raw.lawfulBasis,
        'jurisdiction':  item.state.geoContext.jurisdiction,
      };
    }
    return RoutedBatch.create('classify', batch);
  }
}

export class ClassifyPiiNode extends MonadicNode<CartographerState, 'redact'> {
  readonly 'name' = 'classify-pii';
  readonly 'outputs' = ['redact'] as const;

  override get outputSchema(): Record<'redact', SchemaObjectType> {
    return {
      'redact': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'redact', CartographerState>> {
    for (const item of batch) {
      const classification = GdprRedactor.classify(item.state.currentEvent);
      item.state.gdprResult = {
        ...item.state.gdprResult,
        'personalDataFields':  classification.personalDataFields,
        'sensitiveDataFields': classification.sensitiveDataFields,
      };
    }
    return RoutedBatch.create('redact', batch);
  }
}

export class RedactPiiNode extends MonadicNode<CartographerState, 'ok' | 'violation'> {
  readonly 'name' = 'redact-pii';
  readonly 'outputs' = ['ok', 'violation'] as const;

  override get outputSchema(): Record<'ok' | 'violation', SchemaObjectType> {
    return {
      'ok':        { 'type': 'object' },
      'violation': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'ok' | 'violation', CartographerState>> {
    const acc = new Map<'ok' | 'violation', ItemType<CartographerState>[]>();

    for (const item of batch) {
      const result = await this.routeItem(item.state);
      for (const error of result.errors) {
        item.state.collectError(error);
      }
      const bucket = acc.get(result.output);
      if (bucket === undefined) {
        acc.set(result.output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<'ok' | 'violation', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private async routeItem(state: CartographerState): Promise<NodeOutputType<'ok' | 'violation'>> {
    // Genuine violation: special-category data with no lawful basis (rare drop).
    if (!GdprRedactor.hasLawfulBasis(state.raw.lawfulBasis, state.raw.specialCategory)) {
      return NodeOutput.create('violation');
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
    return NodeOutput.create('ok');
  }
}
// #endregion gdpr-nodes

export const consentGate = new ConsentGateNode();
export const classifyPii = new ClassifyPiiNode();
export const redactPii = new RedactPiiNode();
