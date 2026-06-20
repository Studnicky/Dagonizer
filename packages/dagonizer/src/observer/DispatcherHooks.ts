import type { NodeStateInterface } from '../NodeStateBase.js';

import type { DispatcherHooksInterface } from './ObserverRelay.js';

/**
 * Public relay surface a dispatcher exposes so `DispatcherHooks` can re-fire
 * observability events across the worker/container boundary without reaching
 * the dispatcher's protected consumer-override hooks directly.
 *
 * These five methods are the relay seam: the container path (`WorkerObserver`,
 * `ChannelDispatch`) drives them with worker-side events so they surface
 * through the same dispatcher observability the in-process path uses. They are
 * distinct from the protected `onNodeStart`/… override hooks consumers subclass;
 * each relay method forwards into the matching protected hook inside the
 * dispatcher, where that protected access is in scope.
 *
 * `onFlowStart`/`onFlowEnd` are deliberately absent: those are top-level
 * concerns owned by the dispatcher's own `execute()` call, never relayed.
 *
 * State parameters are `NodeStateInterface` rather than the dispatcher's `TState`
 * because hooks fire for every node — including embedded child nodes whose
 * concrete state class differs from the top-level `TState`. Consumers that need
 * typed state fields narrow locally via a type guard at their hook implementation.
 */
export interface DispatcherRelaySourceInterface {
  relayNodeStart(nodeName: string, state: NodeStateInterface, placementPath: readonly string[]): void;
  relayNodeEnd(nodeName: string, output: string | null, state: NodeStateInterface, placementPath: readonly string[]): void;
  relayError(nodeName: string, error: Error, state: NodeStateInterface, placementPath: readonly string[]): void;
  relayPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void;
  relayPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void;
}

/**
 * Stable `DispatcherHooksInterface` adapter bound to a dispatcher's relay seam.
 *
 * A fresh object-literal of five arrow functions would produce a new anonymous
 * hidden class on every dispatcher construction. `DispatcherHooks` is a named
 * class whose shape is fixed at declaration time: every dispatcher's relay
 * adapter shares one hidden class, keeping relay construction monomorphic. The
 * single `#source` field holds the dispatcher; each method forwards to the
 * matching relay entry.
 *
 * Constructed once per dispatcher (in the `Dagonizer` constructor) and reused by
 * every `relayFor` call.
 */
export class DispatcherHooks implements DispatcherHooksInterface {
  readonly #source: DispatcherRelaySourceInterface;

  constructor(source: DispatcherRelaySourceInterface) {
    this.#source = source;
  }

  onNodeStart(nodeName: string, state: NodeStateInterface, placementPath: readonly string[]): void {
    this.#source.relayNodeStart(nodeName, state, placementPath);
  }

  onNodeEnd(nodeName: string, output: string | null, state: NodeStateInterface, placementPath: readonly string[]): void {
    this.#source.relayNodeEnd(nodeName, output, state, placementPath);
  }

  onError(nodeName: string, error: Error, state: NodeStateInterface, placementPath: readonly string[]): void {
    this.#source.relayError(nodeName, error, state, placementPath);
  }

  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void {
    this.#source.relayPhaseEnter(dagName, phase, placementName, state, placementPath);
  }

  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, state: NodeStateInterface, placementPath: readonly string[]): void {
    this.#source.relayPhaseExit(dagName, phase, placementName, state, placementPath);
  }
}
