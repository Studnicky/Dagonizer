/**
 * exampleDags: archivist DAG topologies for the docs `<DagGraph>` showcase.
 *
 * The archivist DAGs are authored as canonical JSON-LD DAG constants. This
 * module re-exports those constants under the names consumed by the graph demo.
 */

import type { DAGType } from '@studnicky/dagonizer';

import { archivistDAG as archivistDag } from '../../../examples/the-archivist/dag.ts';
import { bookSearchScatterDAG as bookSearchDag } from '../../../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts';
import { composeRetryLoopDAG as composeLoopDag } from '../../../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts';

export const archivistDAG: DAGType         = archivistDag;
export const BookSearchScatterDAG: DAGType = bookSearchDag;
export const ComposeRetryLoopDAG: DAGType  = composeLoopDag;
