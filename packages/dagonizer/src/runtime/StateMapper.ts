import type { StateAccessor } from '../contracts/StateAccessor.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class StateMapper<TState extends NodeStateInterface> {
  readonly #accessor: StateAccessor;

  constructor(accessor: StateAccessor) {
    this.#accessor = accessor;
  }

  createChild(parentState: TState, inputMapping?: Record<string, string>): TState {
    const childState = parentState.clone() as TState;
    if (inputMapping) {
      for (const [childKey, parentKey] of Object.entries(inputMapping)) {
        this.#accessor.set(childState, childKey, this.#accessor.get(parentState, parentKey));
      }
    }
    return childState;
  }

  /**
   * Copy fields from `childState` back to `parentState` using `output` mapping.
   * `output` entries are `{ parentPath: childKey }`: for each entry, read
   * `childKey` from `childState` and write it to `parentPath` on `parentState`.
   */
  mapOutput(childState: TState, parentState: TState, output: Record<string, string> | undefined): void {
    if (output === undefined) return;
    for (const [parentKey, childKey] of Object.entries(output)) {
      this.#accessor.set(parentState, parentKey, this.#accessor.get(childState, childKey));
    }
  }
}
