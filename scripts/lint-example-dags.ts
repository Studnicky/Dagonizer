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
 *      (`examples/0*.ts`) import from these modules.
 *
 * EXCEPTION: `examples/dags/09-terminals.ts` exports `dag1`, which deliberately
 * retains a bare `null` route to demonstrate the implicit-terminal pattern. It
 * is intentionally omitted from the registry below so the linter still flags
 * bare null routes everywhere else.
 *
 * Run: tsx scripts/lint-example-dags.ts  (npm: pnpm run lint:dags)
 */

import type { DAGType } from '../packages/dagonizer/src/entities/dag/DAG.js';
import { WellFormedValidator } from '../packages/dagonizer/src/validation/WellFormedValidator.js';

// ── The Archivist: build DAGs via their factories ─────────────────────────────
// Services-injected nodes must be constructed before factories can run.
// Use recorded/offline services so importing stays side-effect-free (no network).
import { ArchivistNodes }                from '../examples/the-archivist/nodes/ArchivistNodes.js';
import { ArchivistBundleFactory }        from '../examples/the-archivist/dag.js';
import { BookSearchScatterBundleFactory } from '../examples/the-archivist/embedded-dags/BookSearchScatterDAG.js';
import { ComposeRetryLoopBundleFactory } from '../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.js';
import { MemoryStore }                   from '../examples/the-archivist/memory/MemoryStore.js';
import { OpenLibrarySearchTool }         from '@studnicky/dagonizer-tool-openlibrary';
import { SubjectSearchTool }             from '@studnicky/dagonizer-tool-openlibrary';
import { GoogleBooksTool }               from '@studnicky/dagonizer-tool-googlebooks';
import { WikipediaSummaryTool }          from '@studnicky/dagonizer-tool-wikipedia';
import type { ArchivistServices }        from '../examples/the-archivist/services.js';
import type { LlmClientInterface }       from '../examples/the-archivist/services.js';

// Stub LLM: satisfies LlmClientInterface type for DAG construction only.
// None of these methods are called during DAG building — they are stored as
// node field references and executed only when the dispatcher runs.
class StubLlm implements LlmClientInterface {
  classifyIntent():    Promise<never> { return Promise.reject(new Error('stub')); }
  extractTerms():      Promise<never> { return Promise.reject(new Error('stub')); }
  decideTools():       Promise<never> { return Promise.reject(new Error('stub')); }
  rankCandidates():    Promise<never> { return Promise.reject(new Error('stub')); }
  compose():           Promise<never> { return Promise.reject(new Error('stub')); }
  composeAuthor():     Promise<never> { return Promise.reject(new Error('stub')); }
  composeReviews():    Promise<never> { return Promise.reject(new Error('stub')); }
  describeBook():      Promise<never> { return Promise.reject(new Error('stub')); }
  composeSimilar():    Promise<never> { return Promise.reject(new Error('stub')); }
  validate():          Promise<never> { return Promise.reject(new Error('stub')); }
  composeMemoryRecall(): Promise<never> { return Promise.reject(new Error('stub')); }
  composeEmptyResponse(): Promise<never> { return Promise.reject(new Error('stub')); }
  suggestStarterQuery(): Promise<never> { return Promise.reject(new Error('stub')); }
  suggestGreeting():   Promise<never> { return Promise.reject(new Error('stub')); }
  suggestVisitorReplyTo(): Promise<never> { return Promise.reject(new Error('stub')); }
  explainTool():       Promise<never> { return Promise.reject(new Error('stub')); }
}

const archivistServices: ArchivistServices = {
  webSearch:        new OpenLibrarySearchTool(),
  googleBooks:      new GoogleBooksTool(),
  subjectSearch:    new SubjectSearchTool(),
  wikipediaSummary: new WikipediaSummaryTool(),
  memory:           new MemoryStore(),
  llm:              new StubLlm(),
  embedder:         null,
  nodeTimeouts:     {},
};

const archivistNodes = ArchivistNodes.build(archivistServices);
const bookSearchBundle   = BookSearchScatterBundleFactory.create(archivistNodes);
const composeLoopBundle  = ComposeRetryLoopBundleFactory.create(archivistNodes);
const parentBundle       = ArchivistBundleFactory.create(archivistNodes);

const archivistDAG        = parentBundle.dags[0];
const bookSearchScatterDAG = bookSearchBundle.dags[0];
const composeRetryLoopDAG  = composeLoopBundle.dags[0];

if (archivistDAG === undefined || bookSearchScatterDAG === undefined || composeRetryLoopDAG === undefined) {
  process.stdout.write('lint-example-dags: archivist factory returned no DAGs.\n');
  process.exit(1);
}

// ── The Cartographer: build geo-resolve DAG via GeoResolveDAG.build() ─────────
import { GeoResolveDAG }      from '../examples/the-cartographer/embedded-dags/GeoResolveDAG.js';
import { GeoResolvers }       from '../examples/the-cartographer/services/GeoResolvers.js';

const cartographerServices = GeoResolvers.recorded();
const geoBundle = GeoResolveDAG.build(
  cartographerServices.reverseGeocoder,
  cartographerServices.ipGeolocator,
);
const geoResolveDAG = geoBundle.dags[0];

if (geoResolveDAG === undefined) {
  process.stdout.write('lint-example-dags: GeoResolveDAG.build() returned no DAGs.\n');
  process.exit(1);
}

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

import { cartographerDAG, eventPipelineTypedDAG }  from '../examples/the-cartographer/dag.js';
import { streamEventDAG }                          from '../examples/the-cartographer/embedded-dags/StreamEventDAG.js';
import { gdprComplianceDAG }                       from '../examples/the-cartographer/embedded-dags/GdprComplianceDAG.js';
import { ingestSourceDAG }                         from '../examples/the-cartographer/embedded-dags/IngestSourceDAG.js';
import { orderEnrichmentDAG }                      from '../examples/the-cartographer/embedded-dags/OrderEnrichmentDAG.js';

const dags: ReadonlyArray<readonly [string, DAGType]> = [
  ['the-archivist / archivistDAG',           archivistDAG],
  ['the-archivist / BookSearchScatterDAG',   bookSearchScatterDAG],
  ['the-archivist / ComposeRetryLoopDAG',    composeRetryLoopDAG],
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
  ['the-cartographer / cartographerDAG',       cartographerDAG],
  ['the-cartographer / ingestSourceDAG',       ingestSourceDAG],
  ['the-cartographer / geoResolveDAG',         geoResolveDAG],
  ['the-cartographer / streamEventDAG',        streamEventDAG],
  ['the-cartographer / orderEnrichmentDAG',    orderEnrichmentDAG],
  ['the-cartographer / eventPipelineTypedDAG', eventPipelineTypedDAG],
  ['the-cartographer / gdprComplianceDAG',     gdprComplianceDAG],
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
