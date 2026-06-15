/**
 * ObservedDagonizer: `Dagonizer` subclass that re-exposes the
 * protected lifecycle hooks as a typed observer bag.
 *
 * Class extension is Dagonizer's only extension surface. The Vue
 * runner needs to react to every node start / end / error / flow-end;
 * it constructs an `ObservedDagonizer` with an observer that
 * Vue refs delegate to. No callbacks pass through the public API; the
 * observer is internal to this subclass.
 *
 * Lives in the docs theme dir (not the package) because it depends on
 * the browser-safe published runtime; consumers writing their own
 * observers do the same.
 */

import { Dagonizer } from '@noocodex/dagonizer';
import type {
  DagonizerOptionsInterface,
  ExecutionResultInterface,
  NodeStateInterface,
} from '@noocodex/dagonizer';

export interface DispatcherObserver<TState extends NodeStateInterface> {
  readonly onFlowStart?:  (dagName: string, state: TState) => void;
  readonly onFlowEnd?:    (dagName: string, state: TState, result: ExecutionResultInterface<TState>) => void;
  readonly onNodeStart?:  (nodeName: string, state: TState, placementPath: readonly string[]) => void;
  readonly onNodeEnd?:    (nodeName: string, output: string | null, state: TState, placementPath: readonly string[]) => void;
  readonly onError?:      (nodeName: string, error: Error, state: TState, placementPath: readonly string[]) => void;
}

export interface ObservedDagonizerOptions<TState extends NodeStateInterface, TServices> extends DagonizerOptionsInterface<TState, TServices> {
  readonly observer?: DispatcherObserver<TState>;
}

export class ObservedDagonizer<
  TState extends NodeStateInterface,
  TServices = undefined,
> extends Dagonizer<TState, TServices> {
  #observer: DispatcherObserver<TState>;

  constructor(options: ObservedDagonizerOptions<TState, TServices> = {}) {
    super(options);
    this.#observer = options.observer ?? {};
  }

  /** Swap the observer mid-life. Useful for Vue components whose ref
   *  identity changes when the visitor opens a new run. */
  setObserver(observer: DispatcherObserver<TState>): void {
    this.#observer = observer;
  }

  protected override onFlowStart(dagName: string, state: TState): void {
    this.#observer.onFlowStart?.(dagName, state);
  }

  protected override onFlowEnd(dagName: string, state: TState, result: ExecutionResultInterface<TState>): void {
    this.#observer.onFlowEnd?.(dagName, state, result);
  }

  protected override onNodeStart(nodeName: string, state: TState, placementPath: readonly string[] = []): void {
    this.#observer.onNodeStart?.(nodeName, state, placementPath);
  }

  protected override onNodeEnd(nodeName: string, output: string | null, state: TState, placementPath: readonly string[] = []): void {
    this.#observer.onNodeEnd?.(nodeName, output, state, placementPath);
  }

  protected override onError(nodeName: string, error: Error, state: TState, placementPath: readonly string[] = []): void {
    this.#observer.onError?.(nodeName, error, state, placementPath);
  }
}
