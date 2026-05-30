/**
 * lint-example-dags: CI lint for authored, side-effect-free DAG definitions.
 *
 * Validates the flagship Archivist DAGs (exported as pure `DAG` consts, so
 * importing them runs no dispatcher) against `WellFormedValidator`: bare `null`
 * flow-ends, dangling targets, and malformed placements fail CI. The numbered
 * `examples/0*.ts` are runnable scripts that execute on import, so they are not
 * imported here; they are kept well-formed by their own typecheck/run.
 *
 * Run: tsx scripts/lint-example-dags.ts  (npm: pnpm run lint:dags)
 */

import type { DAG } from '../packages/dagonizer/src/entities/dag/DAG.js';
import { WellFormedValidator } from '../packages/dagonizer/src/validation/WellFormedValidator.js';

import { BookSearchScatterDAG } from '../examples/the-archivist/embedded-dags/BookSearchScatterDAG.js';
import { ComposeRetryLoopDAG }  from '../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.js';
import { archivistDAG }         from '../examples/the-archivist/dag.js';

const dags: ReadonlyArray<readonly [string, DAG]> = [
  ['the-archivist / archivistDAG',         archivistDAG],
  ['the-archivist / BookSearchScatterDAG', BookSearchScatterDAG],
  ['the-archivist / ComposeRetryLoopDAG',  ComposeRetryLoopDAG],
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
