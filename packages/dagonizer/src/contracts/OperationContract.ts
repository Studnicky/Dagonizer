/**
 * OperationContract: adapter contract for contract-derived flow generation.
 *
 * Each operation declares the field paths it `hardRequired` to run, the
 * field paths it `produces`, and the output ports it emits. `DAGDeriver`
 * matches `produces ↔ hardRequired` to derive the DAG topology: an edge
 * `A → B` exists iff some path in `A.produces` appears in `B.hardRequired`.
 * Every port in `outputs` auto-wires to the next derived stage unless
 * `DAGDeriverAnnotations.terminals[name]` overrides a specific port.
 *
 * Multi-port nodes (e.g. `['success', 'cached', 'skipped', 'error']`)
 * route every port uniformly with one contract field instead of N
 * terminal annotations. Adding a new operation becomes a one-line
 * registration; the flow updates automatically.
 *
 * The `hardRequired` and `produces` fields are defined by `OperationContractFragment`.
 * The standalone `OperationContract` extends the fragment with `name` and `outputs`
 * for use with `DAGDeriver.derive({ contracts })`. When co-locating the contract
 * on a node via `NodeInterface.contract`, use `OperationContractFragment` directly;
 * the node's own `name` and `outputs` complete the full surface.
 */
import type { OperationContractFragment } from './OperationContractFragment.js';

export interface OperationContract extends OperationContractFragment {
  /** Operation name. Matches `NodeInterface.name` used at registration. */
  name: string;
  /**
   * Output ports the operation can emit. Must match the node's
   * `outputs` declaration at registration. Every port routes to the
   * next derived stage; `DAGDeriverAnnotations.terminals` overrides
   * individual ports.
   */
  outputs: string[];
}
