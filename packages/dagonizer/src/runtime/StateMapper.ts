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

import type { StateAccessorInterface } from '../contracts/StateAccessorInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class StateMapper<TState extends NodeStateInterface> {
  readonly #accessor: StateAccessorInterface;

  constructor(accessor: StateAccessorInterface) {
    this.#accessor = accessor;
  }

  cloneChild(parentState: TState, inputMapping: Record<string, string>): TState {
    const childState = parentState.clone();
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
   */
  mapOutput(childState: TState, parentState: TState, output: Record<string, string>): void {
    for (const [parentKey, childKey] of Object.entries(output)) {
      this.#accessor.set(parentState, parentKey, this.#accessor.get(childState, childKey));
    }
  }
}
