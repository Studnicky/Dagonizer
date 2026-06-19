/**
 * @studnicky/dagonizer-patterns-graph: triple-store node pattern bases.
 *
 * Each pattern operates against a TripleStoreInterface service the consumer
 * provides on `services.memory`. Subclass and inject the SPARQL
 * patterns / binding maps / digest builders specific to your domain.
 */

export { GraphNode } from './GraphNode.js';
export type { GraphServicesType } from './GraphNode.js';

export { RecallContextNode } from './RecallContextNode.js';
export { RecordFindingsNode } from './RecordFindingsNode.js';
export { MemoryDigestNode } from './MemoryDigestNode.js';

export { RdfStore } from './RdfStore.js';
export type { RdfStoreOptionsType } from './RdfStore.js';
