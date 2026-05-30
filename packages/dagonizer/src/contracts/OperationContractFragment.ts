/**
 * OperationContractFragment: the deriver-only fields of an OperationContract.
 *
 * Lives on NodeInterface.contract so the node carries its own data-flow
 * declaration. The node supplies `name` and `outputs` via its own fields;
 * the fragment carries the fields the deriver uses to build edges.
 */
export interface OperationContractFragment {
  /** Field paths the operation requires to be present on state to run. */
  readonly hardRequired: readonly string[];
  /** Field paths the operation writes to state on success. */
  readonly produces: readonly string[];
}
