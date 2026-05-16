/**
 * OperationContract — adapter contract for contract-derived flow generation.
 *
 * Each operation declares the field paths it `hardRequired` to run and the
 * field paths it `produces`. `FlowDeriver` matches `produces ↔ hardRequired`
 * to derive the DAG topology automatically: an edge `A → B` exists iff
 * some path in `A.produces` appears in `B.hardRequired`.
 *
 * Adding a new operation becomes a one-line registration; the flow updates
 * automatically. The hand-authored DAG-by-edge approach is a fallback for
 * cases the contract graph cannot express (alternate exits, fan-out roots),
 * supplied through the `FlowAnnotations` argument to `FlowDeriver.derive`.
 */
export interface OperationContract {
  /** Operation name. Matches `NodeInterface.name` used at registration. */
  readonly name: string;
  /** Field paths the operation requires to be present on state to run. */
  readonly hardRequired: readonly string[];
  /** Field paths the operation writes to state on success. */
  readonly produces: readonly string[];
}
