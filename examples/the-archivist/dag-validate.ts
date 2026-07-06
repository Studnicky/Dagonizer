/**
 * Well-formedness validation: check three DAGs for authoring violations.
 *
 * `WellFormedValidator.check` returns an array of human-readable strings;
 * an empty array means the DAG is well-formed. Runs on:
 *   archivistDAG        — the parent DAG
 *   BookSearchScatterDAG — the query/scatter sub-DAG
 *   ComposeRetryLoopDAG  — the compose/validate sub-DAG
 */

// #region well-formed-validate
import { WellFormedValidator } from '@studnicky/dagonizer/validation';

import { archivistDAG } from './dag.ts';
import { bookSearchScatterDAG } from './embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopDAG } from './embedded-dags/ComposeRetryLoopDAG.ts';

const dags = [
  { label: 'the-archivist',        dag: archivistDAG },
  { label: 'book-search-scatter',  dag: bookSearchScatterDAG },
  { label: 'compose-retry-loop',   dag: composeRetryLoopDAG },
] as const;

for (const { label, dag } of dags) {
  const violations = WellFormedValidator.check(dag);
  if (violations.length === 0) {
    console.log(`dag-validate [${label}]: well-formed`);
  } else {
    console.log(`dag-validate [${label}]: ${violations.length} violation(s)`);
    for (const v of violations) {
      console.log(`  - ${v}`);
    }
  }
}
// #endregion well-formed-validate
