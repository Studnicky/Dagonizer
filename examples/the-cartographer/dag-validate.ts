/**
 * Well-formedness validation: check all three Cartographer DAGs.
 *
 * `WellFormedValidator.check` returns an array of human-readable strings;
 * an empty array means the DAG is well-formed.
 */

// #region well-formed-validate
import { WellFormedValidator } from '@noocodex/dagonizer/validation';

import { cartographerDAG, eventPipelineDAG } from './dag.ts';
import { canonicalizeDAG } from './embedded-dags/CanonicalizeDAG.ts';
import { gdprComplianceDAG } from './embedded-dags/GdprComplianceDAG.ts';
import { geoResolveDAG } from './embedded-dags/GeoResolveDAG.ts';
import { ingestSourceDAG } from './embedded-dags/IngestSourceDAG.ts';
import { orderEnrichmentDAG } from './embedded-dags/OrderEnrichmentDAG.ts';

const dags = [
  { 'label': 'cartographer',      'dag': cartographerDAG },
  { 'label': 'ingest-source',     'dag': ingestSourceDAG },
  { 'label': 'geo-resolve',       'dag': geoResolveDAG },
  { 'label': 'canonicalize',      'dag': canonicalizeDAG },
  { 'label': 'order-enrichment',  'dag': orderEnrichmentDAG },
  { 'label': 'event-pipeline',    'dag': eventPipelineDAG },
  { 'label': 'gdpr-compliance',   'dag': gdprComplianceDAG },
] as const;

let anyViolation = false;
for (const { label, dag } of dags) {
  const violations = WellFormedValidator.check(dag);
  if (violations.length === 0) {
    console.log(`dag-validate [${label}]: well-formed`);
  } else {
    anyViolation = true;
    console.log(`dag-validate [${label}]: ${violations.length} violation(s)`);
    for (const v of violations) {
      console.log(`  - ${v}`);
    }
  }
}
if (anyViolation) process.exit(1);
// #endregion well-formed-validate
