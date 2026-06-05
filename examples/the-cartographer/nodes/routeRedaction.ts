/**
 * route-redaction: conditional redaction branch (the second headline skip).
 *
 * The redaction sub-DAG is expensive and only needed when an event carries PII
 * that a regime requires handling. This node routes PAST the gdpr embedded DAG
 * directly to aggregate-event when redaction is NOT required:
 *   - the event carries no recipient PII (`canonical.pii === false`), OR
 *   - the source already handled consent/PII (`canonical.consentHandled`), OR
 *   - the regime is light (jurisdiction baseline / international-waters) AND
 *     consent is valid — no redaction obligation.
 * Otherwise it routes to `gdpr` (run the redaction sub-DAG).
 *
 * On the skip path: sets a minimal no-op GdprResult (redaction NOT applied,
 * precise coords retained, marketing analytics eligibility from consent) and
 * records state.routing.redactionSkipped so aggregate-event's routing record
 * carries the correct flags. Precise coords are left intact.
 *
 * Records the decision on state.routing so the parent's summarize totals the
 * redaction savings.
 *
 * Routes 'needs-redaction' (run gdpr) or 'skip-redaction' (bypass directly to
 * aggregate-event — no intermediate node).
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { Consent } from '../services.ts';

import type { NodeInterface } from '@noocodex/dagonizer';

// #region route-redaction-node
export const routeRedaction: NodeInterface<CartographerState, 'needs-redaction' | 'skip-redaction', CartographerServices> = {
  'name': 'route-redaction',
  'outputs': ['needs-redaction', 'skip-redaction'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const ev = state.currentEvent;
    const hasPii =
      state.canonical.pii === true ||
      ev.recipientName.length > 0 ||
      ev.recipientEmail.length > 0;
    const alreadyHandled = state.canonical.consentHandled === true;

    const consentStatus = Consent.statusFor(ev.shipmentId, ev.marketingConsent);
    const juris = state.geoContext.jurisdiction;
    const lightRegime = juris === 'baseline' || juris === 'international-waters';
    // Light regime + valid consent imposes no redaction obligation.
    const notRequired = lightRegime && consentStatus === 'valid';

    const skip = !hasPii || alreadyHandled || notRequired;

    if (skip) {
      state.routing = { ...state.routing, 'redactionSkipped': true, 'redactionRun': false };
      // Set a minimal no-op GdprResult: redaction NOT applied, precise coords
      // retained. Marketing analytics eligibility still tracks valid consent.
      state.gdprResult = {
        ...state.gdprResult,
        'consentStatus':              consentStatus,
        'lawfulBasis':                state.raw.lawfulBasis,
        'jurisdiction':               state.geoContext.jurisdiction,
        'redactionApplied':           false,
        'coordsCoarsened':            false,
        'marketingAnalyticsEligible': consentStatus === 'valid',
      };
      return { 'output': 'skip-redaction' };
    }
    state.routing = { ...state.routing, 'redactionRun': true, 'redactionSkipped': false };
    return { 'output': 'needs-redaction' };
  },
};
// #endregion route-redaction-node
