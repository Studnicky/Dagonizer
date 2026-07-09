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
 *   .embed(gdprPlacementIri, gdprComplianceDagIri,
 *     { 'success': aggregateEventPlacementIri, 'error': gdprViolationPlacementIri },
 *     { 'outputs': { 'currentEvent':'currentEvent', 'gdprResult':'gdprResult' } })
 *
 * The embedded DAG runs in a CLONED child state. Its nodes redact PII on
 * state.currentEvent and write state.gdprResult; the `outputs` mapping copies
 * those two fields back into the parent shipment-pipeline clone when the
 * sub-DAG completes (child-key → parent-path orientation).
 */

// #region gdpr-compliance-dag
import { consentGate, classifyPii, redactPii } from '../nodes/gdprNodes.ts';
import { CARTOGRAPHER_IRIS } from '../cartographerIds.ts';
import type { CartographerState } from '../CartographerState.ts';

import type { DAGType, DispatcherBundleType } from '@studnicky/dagonizer';
import { DAGBuilder } from '@studnicky/dagonizer';

const GDPR_COMPLIANCE_DAG_IRI = CARTOGRAPHER_IRIS.dag.gdprCompliance;

export const gdprComplianceDAG: DAGType = new DAGBuilder(GDPR_COMPLIANCE_DAG_IRI, '1.0')

  // ── 1. consent-gate ──────────────────────────────────────────────────────
  // Resolves the consent status from marketingConsent + simulated expiry.
  // Always routes 'classify' (both consented and non-consented proceed;
  // the consent status drives redaction rules downstream).
  .node(CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'consent-gate'), consentGate, {
    'classify': CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'classify-pii'),
  })

  // ── 2. classify-pii ──────────────────────────────────────────────────────
  // Records which fields are personal/sensitive; no routing decision yet.
  .node(CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'classify-pii'), classifyPii, {
    'redact': CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'redact-pii'),
  })

  // ── 3. redact-pii ────────────────────────────────────────────────────────
  // Applies GdprRedactor.redact. Routes to 'compliant' (ok) or 'violation'.
  .node(CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'redact-pii'), redactPii, {
    'ok':        CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'compliant'),
    'violation': CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'violation'),
  })

  // ── Terminals ─────────────────────────────────────────────────────────────
  .terminal(CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'compliant'), { outcome: 'completed' })
  .terminal(CARTOGRAPHER_IRIS.placementIri(GDPR_COMPLIANCE_DAG_IRI, 'violation'), { outcome: 'failed' })

  .build();
// #endregion gdpr-compliance-dag

export const gdprComplianceBundle: DispatcherBundleType<CartographerState> = {
  'nodes': [consentGate, classifyPii, redactPii],
  'dags': [gdprComplianceDAG],
};
