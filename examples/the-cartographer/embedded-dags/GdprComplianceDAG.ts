/**
 * GdprComplianceDAG: reusable GDPR compliance sub-pipeline.
 *
 * Internal flow:
 *
 *   consent-gate
 *     └─ classify ──► classify-pii
 *   classify-pii
 *     └─ redact ──► redact-pii
 *   redact-pii
 *     ├─ ok        ──► compliant  (TerminalNode completed → parent routes 'success')
 *     └─ violation ──► violation  (TerminalNode failed   → parent routes 'error')
 *
 * Embedded via:
 *   .embeddedDAG('gdpr', 'gdpr-compliance',
 *     { 'success':'aggregate-event', 'error':'gdpr-violation' },
 *     { 'outputs': { 'currentEvent':'currentEvent', 'gdprResult':'gdprResult' } })
 *
 * The embedded DAG runs in a CLONED child state. Its nodes redact PII on
 * state.currentEvent and write state.gdprResult; the `outputs` mapping copies
 * those two fields back into the parent shipment-pipeline clone when the
 * sub-DAG completes (child-key → parent-path orientation).
 */

// #region gdpr-compliance-dag
import { consentGate, classifyPii, redactPii } from '../nodes/gdprNodes.ts';
import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';

import type { DAG, DispatcherBundle } from '@noocodex/dagonizer';
import { DAGBuilder } from '@noocodex/dagonizer';

export const gdprComplianceDAG: DAG = new DAGBuilder('gdpr-compliance', '1.0')

  // ── 1. consent-gate ──────────────────────────────────────────────────────
  // Resolves the consent status from marketingConsent + simulated expiry.
  // Always routes 'classify' (both consented and non-consented proceed;
  // the consent status drives redaction rules downstream).
  .node('consent-gate', consentGate, {
    'classify': 'classify-pii',
  })

  // ── 2. classify-pii ──────────────────────────────────────────────────────
  // Records which fields are personal/sensitive; no routing decision yet.
  .node('classify-pii', classifyPii, {
    'redact': 'redact-pii',
  })

  // ── 3. redact-pii ────────────────────────────────────────────────────────
  // Applies GdprRedactor.redact. Routes to 'compliant' (ok) or 'violation'.
  .node('redact-pii', redactPii, {
    'ok':        'compliant',
    'violation': 'violation',
  })

  // ── Terminals ─────────────────────────────────────────────────────────────
  .terminal('compliant', { outcome: 'completed' })
  .terminal('violation', { outcome: 'failed' })

  .build();
// #endregion gdpr-compliance-dag

export const gdprComplianceBundle: DispatcherBundle<CartographerState, CartographerServices> = {
  'nodes': [consentGate, classifyPii, redactPii],
  'dags': [gdprComplianceDAG],
};
