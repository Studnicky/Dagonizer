/**
 * ChildStateFactoryType: constructor thunk that produces the initial child
 * state for an embedded or scatter sub-DAG body execution.
 *
 * The factory receives the parent `NodeStateInterface` and returns a new child
 * state. The default factory (`ChildStateFactory.cloneParent`) clones the
 * parent. An isolation factory ignores `parent` and constructs a fresh
 * child-specific state class instead.
 *
 * The engine ALWAYS calls a factory; there is no conditional branch. Every
 * registered DAG has an entry in the dispatcher's `stateFactories` map because
 * `registerDAG` materialises the default at registration time when the caller
 * omits an override.
 */

import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * A function that produces the initial child state for a sub-DAG body run.
 *
 * @param parent - The parent node state at the point of sub-DAG invocation.
 *                 A clone-parent factory returns `parent.clone()`. An isolation
 *                 factory ignores `parent` and builds a fresh child-specific
 *                 instance.
 * @returns A `NodeStateInterface` that seeds the child DAG body execution.
 */
export type ChildStateFactoryType = (parent: NodeStateInterface) => NodeStateInterface;
