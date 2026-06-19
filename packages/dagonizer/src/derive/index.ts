/**
 * `@studnicky/dagonizer/derive`: contract-derived flow generation.
 *
 *   - `OperationContractType`: adapter contract describing one operation's
 *     `produces` and `hardRequired` field paths
 *   - `DAGDeriver.derive`: derive a `DAG` from a contract registry plus
 *     declared `DAGDeriverAnnotationsType` for non-derivable routing
 */

export { DAGDeriver } from './DAGDeriver.js';
export type { DAGDeriverOptionsType } from './DAGDeriver.js';
export type {
  DAGDeriverAnnotationsType,
  DAGDeriverEmitTerminalType,
  DAGDeriverEmbeddedDAGType,
  DAGDeriverScatterType,
  DAGDeriverTerminalType,
} from './DAGDeriverAnnotations.js';
export { ContractRegistryValidator } from './ContractRegistryValidator.js';
