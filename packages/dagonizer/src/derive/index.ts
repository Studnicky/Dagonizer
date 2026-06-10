/**
 * `@noocodex/dagonizer/derive`: contract-derived flow generation.
 *
 *   - `OperationContract`: adapter contract describing one operation's
 *     `produces` and `hardRequired` field paths
 *   - `DAGDeriver.derive`: derive a `DAG` from a contract registry plus
 *     declared `DAGDeriverAnnotations` for non-derivable routing
 */

export { DAGDeriver } from './DAGDeriver.js';
export type { DAGDeriverOptions } from './DAGDeriver.js';
export type {
  DAGDeriverAnnotations,
  DAGDeriverEmitTerminal,
  DAGDeriverEmbeddedDAG,
  DAGDeriverScatter,
  DAGDeriverTerminal,
} from './DAGDeriverAnnotations.js';
export { ContractRegistryValidator } from './ContractRegistryValidator.js';
