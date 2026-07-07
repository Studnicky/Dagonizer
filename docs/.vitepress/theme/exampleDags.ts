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
import { streamProducerCandidatesDag as archivistStreamProducerDag } from '../../../examples/the-archivist/streaming/ArchivistStreamingDAGs.ts';
import { reservoirDag as scatterExtensionsDag } from '../../../examples/dags/scatter-extensions.ts';
import { dag as virtualClockDag } from '../../../examples/dags/virtual-clock.ts';
import { agentDag as reactAgentDag, traceDag as reactTraceDag } from '../../../examples/dags/react-agent-memory.ts';
import { routingDag as reactRoutingDag } from '../../../examples/dags/react-agent-routing.ts';
import { supportDispatcherDAG as dispatcherDag } from '../../../examples/the-dispatcher/dag.ts';
import { cartographerDAG as cartographerDag, cartographerResumeDAG as cartographerResumeDag, cartographerWorkersDAG as cartographerWorkersDag } from '../../../examples/the-cartographer/dag.ts';
import { gdprComplianceDAG as gdprDag } from '../../../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts';
import { ingestSourceDAG as ingestDag } from '../../../examples/the-cartographer/embedded-dags/IngestSourceDAG.ts';
import { normalizeCsvDAG as normalizeCsvDag } from '../../../examples/the-cartographer/embedded-dags/NormalizeCsvDAG.ts';
import { normalizeJsonDAG as normalizeJsonDag } from '../../../examples/the-cartographer/embedded-dags/NormalizeJsonDAG.ts';
import { streamEventDAG as streamDag } from '../../../examples/the-cartographer/embedded-dags/StreamEventDAG.ts';

export const archivistDAG: DAGType         = archivistDag;
export const BookSearchScatterDAG: DAGType = bookSearchDag;
export const ComposeRetryLoopDAG: DAGType  = composeLoopDag;
export const archivistStreamProducerDAG: DAGType = archivistStreamProducerDag;
export const scatterExtensionsDAG: DAGType = scatterExtensionsDag;
export const virtualClockDAG: DAGType = virtualClockDag;
export const reactAgentDAG: DAGType        = reactAgentDag;
export const reactTraceDAG: DAGType        = reactTraceDag;
export const reactRoutingDAG: DAGType      = reactRoutingDag;
export const supportDispatcherDAG: DAGType = dispatcherDag;
export const cartographerDAG: DAGType      = cartographerDag;
export const cartographerResumeDAG: DAGType = cartographerResumeDag;
export const cartographerWorkersDAG: DAGType = cartographerWorkersDag;
export const gdprComplianceDAG: DAGType    = gdprDag;
export const ingestSourceDAG: DAGType      = ingestDag;
export const normalizeCsvDAG: DAGType      = normalizeCsvDag;
export const normalizeJsonDAG: DAGType     = normalizeJsonDag;
export const streamEventDAG: DAGType       = streamDag;
