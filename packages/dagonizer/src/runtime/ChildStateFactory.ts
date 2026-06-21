/**
 * ChildStateFactory: domain class for child-state construction thunks.
 *
 * `ChildStateFactoryType` (defined in `contracts/ChildStateFactoryType.ts`) is
 * the constructor thunk that produces the initial child state for an embedded or
 * scatter sub-DAG body execution.
 *
 * `ChildStateFactory.cloneParent` is the engine default — it clones the parent,
 * reproducing historical clone-parent semantics. An isolation factory ignores
 * `parent` and constructs a fresh child-specific state class instead.
 *
 * The engine ALWAYS calls a factory; there is no conditional fallback. Every
 * registered DAG has an entry in the dispatcher's `stateFactories` map because
 * `registerDAG` materialises the default at registration time when the caller
 * omits an override.
 */

import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';

/**
 * Domain class for child-state factory constants.
 *
 * Consumers use `ChildStateFactory.cloneParent` to obtain the default factory
 * (clone-parent semantics) and supply it (or an isolation override) to
 * `registerDAG`.
 */
export class ChildStateFactory {
  private constructor() {}

  /**
   * Default child-state factory: clones the parent state.
   *
   * Reproduces the historical clone-parent semantics exactly. All DAGs that do
   * not supply an explicit override factory receive this value at `registerDAG`
   * time. The engine never branches on factory presence — it always looks one
   * up and calls it.
   */
  static readonly cloneParent: ChildStateFactoryType = (parent) => parent.clone();
}
