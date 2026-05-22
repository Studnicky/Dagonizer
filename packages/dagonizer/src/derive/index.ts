/**
 * `@noocodex/dagonizer/derive` — contract-derived flow generation.
 *
 *   - `OperationContract` — adapter contract describing one operation's
 *     `produces` and `hardRequired` field paths
 *   - `DAGDeriver.derive` — derive a `DAG` from a contract registry plus
 *     declared `DAGDeriverAnnotations` for non-derivable routing
 */

export { DAGDeriver } from './DAGDeriver.js';
export type { DAGDeriverOptions } from './DAGDeriver.js';
export type {
  DAGDeriverAnnotations,
  DAGDeriverEmitTerminal,
  DAGDeriverSubDAG,
  DAGDeriverFanOut,
  DAGDeriverTerminal,
} from './DAGDeriverAnnotations.js';
export type { OperationContract } from '../contracts/OperationContract.js';
export type { OperationContractFragment } from '../contracts/OperationContractFragment.js';
export { ContractRegistryValidator } from './ContractRegistryValidator.js';
