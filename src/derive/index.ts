/**
 * `@noocodex/dagonizer/derive` — contract-derived flow generation.
 *
 *   - `OperationContract` — adapter contract describing one operation's
 *     `produces` and `hardRequired` field paths
 *   - `FlowDeriver.derive` — derive a `DAG` from a contract registry plus
 *     declared `FlowAnnotations` for non-derivable routing
 */

export { FlowDeriver } from './FlowDeriver.js';
export type { FlowDeriverOptions } from './FlowDeriver.js';
export type {
  FlowAnnotations,
  FlowFanOut,
  FlowTerminal,
} from './FlowAnnotations.js';
export type { OperationContract } from '../contracts/OperationContract.js';
