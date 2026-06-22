/**
 * `@studnicky/dagonizer/dag`: DAG document surface.
 *
 * Houses the engine-coupled DAG concepts that sit above `./entities` (which
 * carries only schemas and `FromSchema` types with zero engine imports).
 * `DAGDocument` owns the single `unknown` ingest boundary and validates wire
 * input against the compiled `Validator`, so it lives here rather than in
 * `./entities`.
 */

export { DAGDocument } from './DAGDocument.js';
export type { DAGDocumentLoadOptionsType } from './DAGDocument.js';
