/**
 * OperationContractFragmentType: the deriver-only fields of an OperationContractType.
 *
 * Lives on NodeInterface.contract so the node carries its own data-flow
 * declaration. The node supplies `name` and `outputs` via its own fields;
 * the fragment carries the fields the deriver uses to build edges.
 */
export type OperationContractFragmentType = {
  /** Field paths the operation requires to be present on state to run. */
  hardRequired: string[];
  /** Field paths the operation writes to state on success. */
  produces: string[];
}

/**
 * Sentinel `OperationContractFragmentType` for nodes that do not participate in
 * derivation. Nodes carry this as their required `contract` field when they
 * have no data-flow declaration; `DAGDeriver.extractContracts` skips fragments
 * where both arrays are empty, so these nodes contribute no derived edges.
 *
 * Mirrors the role of `Timeout.none()` for the `timeout` field.
 */
export const EMPTY_CONTRACT_FRAGMENT: OperationContractFragmentType = {
  'hardRequired': [],
  'produces': [],
};
