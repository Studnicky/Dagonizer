/**
 * lint-example-dags: CI lint for authored, side-effect-free DAG definitions.
 *
 * Validates the authored DAG definitions against `WellFormedValidator`: bare
 * `null` flow-ends, dangling targets, and malformed placements fail CI. Two
 * families of pure DAG modules are checked:
 *
 *   1. The flagship Archivist DAGs (`examples/the-archivist/...`).
 *   2. The numbered-example DAG definitions (`examples/dags/*.ts`). These are
 *      pure modules — exported `DAG` consts with zero top-level side effects —
 *      so importing them runs no dispatcher. The runnable entry points
 *      (`examples/0*.ts`, `examples/derive.ts`) import from these modules.
 *
 * EXCEPTION: `examples/dags/09-terminals.ts` exports `dag1`, which deliberately
 * retains a bare `null` route to demonstrate the implicit-terminal pattern. It
 * is intentionally omitted from the registry below so the linter still flags
 * bare null routes everywhere else.
 *
 * Run: tsx scripts/lint-example-dags.ts  (npm: pnpm run lint:dags)
 */

import type { DAG } from '../packages/dagonizer/src/entities/dag/DAG.js';
import { WellFormedValidator } from '../packages/dagonizer/src/validation/WellFormedValidator.js';

import { BookSearchScatterDAG } from '../examples/the-archivist/embedded-dags/BookSearchScatterDAG.js';
import { ComposeRetryLoopDAG }  from '../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.js';
import { archivistDAG }         from '../examples/the-archivist/dag.js';

import { dag as linearDAG }          from '../examples/dags/01-linear.js';
import { dag as builderDAG }         from '../examples/dags/02-builder.topology.js';
import { dag as schemaDAG }          from '../examples/dags/03-schema.js';
import { dag as scatterDAG }         from '../examples/dags/04-scatter.js';
import { dag as scatterCollectDAG }  from '../examples/dags/04b-scatter-collect.js';
import { child as embeddedChildDAG, parent as embeddedParentDAG } from '../examples/dags/05-embedded-dags.js';
import { dag as cancellationDAG }    from '../examples/dags/06-cancellation.js';
import { dag as retryDAG }           from '../examples/dags/07-retry.js';
import { dag as checkpointDAG }      from '../examples/dags/08-checkpoint.js';
// NOTE: dag1 (demo-null-route) is intentionally excluded — see EXCEPTION above.
import {
  dag2 as terminalsCompletedDAG,
  dag3 as terminalsFailedDAG,
  dag4 as terminalsEmbeddedDAG,
  childDAG as terminalsChildDAG,
} from '../examples/dags/09-terminals.js';
import { childDag as sharedChildDAG, parentDag as sharedParentDAG } from '../examples/dags/10-shared-state.js';
import { childDAG as deriveChildDAG, parentDAG as deriveParentDAG } from '../examples/dags/derive.js';

import { cartographerDAG, eventPipelineDAG }      from '../examples/the-cartographer/dag.js';
import { canonicalizeDAG }                        from '../examples/the-cartographer/embedded-dags/CanonicalizeDAG.js';
import { gdprComplianceDAG }                      from '../examples/the-cartographer/embedded-dags/GdprComplianceDAG.js';
import { geoResolveDAG }                          from '../examples/the-cartographer/embedded-dags/GeoResolveDAG.js';
import { ingestSourceDAG }                        from '../examples/the-cartographer/embedded-dags/IngestSourceDAG.js';
import { ingestJsonDAG }                          from '../examples/the-cartographer/embedded-dags/IngestJsonDAG.js';
import { ingestCsvDAG }                           from '../examples/the-cartographer/embedded-dags/IngestCsvDAG.js';
import { ingestNdjsonGzDAG }                      from '../examples/the-cartographer/embedded-dags/IngestNdjsonGzDAG.js';
import { orderEnrichmentDAG }                     from '../examples/the-cartographer/embedded-dags/OrderEnrichmentDAG.js';

const dags: ReadonlyArray<readonly [string, DAG]> = [
  ['the-archivist / archivistDAG',           archivistDAG],
  ['the-archivist / BookSearchScatterDAG',   BookSearchScatterDAG],
  ['the-archivist / ComposeRetryLoopDAG',    ComposeRetryLoopDAG],
  ['dags / 01-linear (chat)',                linearDAG],
  ['dags / 02-builder.topology (chat)',      builderDAG],
  ['dags / 03-schema (from-json)',           schemaDAG],
  ['dags / 04-scatter (scrape)',             scatterDAG],
  ['dags / 04b-scatter-collect',             scatterCollectDAG],
  ['dags / 05-embedded-dags (child)',        embeddedChildDAG],
  ['dags / 05-embedded-dags (parent)',       embeddedParentDAG],
  ['dags / 06-cancellation (slow-dag)',      cancellationDAG],
  ['dags / 07-retry (retry-dag)',            retryDAG],
  ['dags / 08-checkpoint (count)',           checkpointDAG],
  ['dags / 09-terminals (dag2 completed)',   terminalsCompletedDAG],
  ['dags / 09-terminals (dag3 failed)',      terminalsFailedDAG],
  ['dags / 09-terminals (dag4 embedded)',    terminalsEmbeddedDAG],
  ['dags / 09-terminals (childDAG)',         terminalsChildDAG],
  ['dags / 10-shared-state (sub-flow)',      sharedChildDAG],
  ['dags / 10-shared-state (main-flow)',     sharedParentDAG],
  ['dags / derive (plugin:transform)',       deriveChildDAG],
  ['dags / derive (parent)',                 deriveParentDAG],
  ['the-cartographer / cartographerDAG',     cartographerDAG],
  ['the-cartographer / ingestSourceDAG',     ingestSourceDAG],
  ['the-cartographer / ingestJsonDAG',       ingestJsonDAG],
  ['the-cartographer / ingestCsvDAG',        ingestCsvDAG],
  ['the-cartographer / ingestNdjsonGzDAG',   ingestNdjsonGzDAG],
  ['the-cartographer / geoResolveDAG',       geoResolveDAG],
  ['the-cartographer / canonicalizeDAG',     canonicalizeDAG],
  ['the-cartographer / orderEnrichmentDAG',  orderEnrichmentDAG],
  ['the-cartographer / eventPipelineDAG',    eventPipelineDAG],
  ['the-cartographer / gdprComplianceDAG',   gdprComplianceDAG],
];

let totalViolations = 0;
for (const [label, dag] of dags) {
  const violations = WellFormedValidator.check(dag);
  if (violations.length > 0) {
    process.stdout.write(`\nDAG: ${label}\n`);
    for (const v of violations) process.stdout.write(`  - ${v}\n`);
    totalViolations += violations.length;
  }
}

if (totalViolations > 0) {
  process.stdout.write(`\nlint-example-dags: ${totalViolations} violation(s) found.\n`);
  process.exit(1);
}
process.stdout.write(`lint-example-dags: all ${dags.length} authored DAGs are well-formed.\n`);
