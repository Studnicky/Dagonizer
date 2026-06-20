/**
 * StateMapper: translates fields between parent and child state objects
 * during scatter/gather node execution.
 *
 * Internal engine class. Not exported through the `runtime/` barrel or
 * any public subpath; it is consumed only by the dispatcher and the
 * scatter implementation. Consumers do not interact with it directly.
 *
 * Uses a `StateAccessorInterface` for dotted-path reads and writes so the mapping
 * logic is decoupled from the concrete accessor implementation.
 */

import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class StateMapper {
  readonly #accessor: StateAccessorInterface;

  constructor(accessor: StateAccessorInterface) {
    this.#accessor = accessor;
  }

  /**
   * Clone the parent state and seed the clone with the input mapping.
   *
   * Used by scatter paths that always clone the parent state. Returns
   * `NodeStateInterface` — the `clone(): this` method on the interface returns
   * the concrete subclass type at runtime; the engine threads the cloned state
   * as `NodeStateInterface` internally and consumers do not need the narrower type.
   *
   * Factory-based sub-DAG body paths use `spawnChild` instead.
   */
  cloneChild(parentState: NodeStateInterface, inputMapping: Record<string, string>): NodeStateInterface {
    const childState = parentState.clone();
    for (const [childKey, parentKey] of Object.entries(inputMapping)) {
      this.#accessor.set(childState, childKey, this.#accessor.get(parentState, parentKey));
    }
    return childState;
  }

  /**
   * Build a child state for factory-based sub-DAG body execution and seed it
   * with the input mapping.
   *
   * Used by embedded-DAG and scatter DAG-body paths. Returns `NodeStateInterface`
   * because an isolation factory builds a child-specific class that is not
   * assignment-compatible with the parent state type. Callers read/write child
   * fields through the `StateAccessorInterface` (dotted-path accessor), which is
   * runtime type-agnostic.
   */
  spawnChild(parentState: NodeStateInterface, inputMapping: Record<string, string>, factory: ChildStateFactoryType): NodeStateInterface {
    const childState = factory(parentState);
    for (const [childKey, parentKey] of Object.entries(inputMapping)) {
      this.#accessor.set(childState, childKey, this.#accessor.get(parentState, parentKey));
    }
    return childState;
  }

  /**
   * Copy fields from `childState` back to `parentState` using `output` mapping.
   * `output` entries are `{ parentPath: childKey }`: for each entry, read
   * `childKey` from `childState` and write it to `parentPath` on `parentState`.
   * Pass `{}` when no output mapping is needed; the loop over an empty object
   * is a no-op.
   *
   * Both states are typed as `NodeStateInterface` because the child may be a
   * different concrete class (produced by an isolation factory); the dotted-path
   * accessor operates on declared fields of the concrete class.
   */
  mapOutput(childState: NodeStateInterface, parentState: NodeStateInterface, output: Record<string, string>): void {
    for (const [parentKey, childKey] of Object.entries(output)) {
      this.#accessor.set(parentState, parentKey, this.#accessor.get(childState, childKey));
    }
  }
}
