/**
 * OperationContract — adapter contract for contract-derived flow generation.
 *
 * Each operation declares the field paths it `hardRequired` to run, the
 * field paths it `produces`, and the output ports it emits. `FlowDeriver`
 * matches `produces ↔ hardRequired` to derive the DAG topology: an edge
 * `A → B` exists iff some path in `A.produces` appears in `B.hardRequired`.
 * Every port in `outputs` auto-wires to the next derived stage unless
 * `FlowAnnotations.terminals[name]` overrides a specific port.
 *
 * Multi-port nodes (e.g. `['success', 'cached', 'skipped', 'error']`)
 * route every port uniformly with one contract field instead of N
 * terminal annotations. Adding a new operation becomes a one-line
 * registration; the flow updates automatically.
 */
export interface OperationContract {
  /** Operation name. Matches `NodeInterface.name` used at registration. */
  readonly name: string;
  /** Field paths the operation requires to be present on state to run. */
  readonly hardRequired: readonly string[];
  /** Field paths the operation writes to state on success. */
  readonly produces: readonly string[];
  /**
   * Output ports the operation can emit. Must match the node's
   * `outputs` declaration at registration. Every port routes to the
   * next derived stage; `FlowAnnotations.terminals` overrides
   * individual ports.
   */
  readonly outputs: readonly string[];
}
