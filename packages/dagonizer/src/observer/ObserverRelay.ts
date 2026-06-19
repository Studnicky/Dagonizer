import type { ObserverRelayInterface } from '../contracts/ObserverRelayInterface.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

/**
 * Hook-forwarding interface that `ObserverRelay` uses to call back into the
 * dispatcher without depending on `Dagonizer` itself. All six observer hooks
 * have the same signatures as the protected hooks on `Dagonizer`; the
 * dispatcher's `relayFor` passes a stable adapter bound to those hooks.
 */
export interface DispatcherHooksInterface<TState extends NodeStateInterface> {
  onNodeStart(nodeName: string, state: TState, placementPath: readonly string[]): void;
  onNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[]): void;
  onError(nodeName: string, error: Error, state: TState, placementPath: readonly string[]): void;
  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: TState, placementPath: readonly string[]): void;
}

/**
 * Stable-class implementation of `ObserverRelayInterface`.
 *
 * A fresh object-literal with 6 arrow-function fields would produce a new
 * anonymous hidden class on every call. `ObserverRelay` is a named class whose
 * shape is fixed at declaration time: V8 sees the same hidden class for every
 * relay instance, keeping inline-caches hot on the container dispatch path.
 *
 * Private fields are initialised in constructor-declaration order so the hidden
 * class is consistent across all instances. Only `relayFor` constructs this.
 */
export class ObserverRelay<TState extends NodeStateInterface> implements ObserverRelayInterface {
  readonly #hooks: DispatcherHooksInterface<TState>;
  readonly #state: TState;

  constructor(hooks: DispatcherHooksInterface<TState>, state: TState) {
    this.#hooks = hooks;
    this.#state = state;
  }

  onNodeStart(nodeName: string, placementPath: readonly string[]): void {
    this.#hooks.onNodeStart(nodeName, this.#state, placementPath);
  }

  onNodeEnd(nodeName: string, output: string | null, placementPath: readonly string[]): void {
    this.#hooks.onNodeEnd(nodeName, output, this.#state, placementPath);
  }

  onError(nodeName: string, error: Error, placementPath: readonly string[]): void {
    this.#hooks.onError(nodeName, error, this.#state, placementPath);
  }

  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void {
    this.#hooks.onPhaseEnter(dagName, phase, placementName, this.#state, placementPath);
  }

  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, placementPath: readonly string[]): void {
    this.#hooks.onPhaseExit(dagName, phase, placementName, this.#state, placementPath);
  }
}
