/**
 * BusObserver: bridges Dagonizer lifecycle hooks to an EventBus topic.
 *
 * Construct a BusObserver, pass it in DagonizerOptionsType.observers[], and
 * every lifecycle event is published to the configured topic. Multiple
 * downstream consumers subscribe to the same bus topic.
 *
 * Each publish is fire-and-forget: the lifecycle hooks on
 * `DispatcherObserverType` are synchronous, so the observer does not await
 * the bus's per-subscriber `BusQueue` delivery. A slow subscriber applies
 * backpressure to its own queue without blocking the dispatcher.
 *
 * @example
 * ```ts
 * import { Dagonizer } from '@studnicky/dagonizer';
 * import { EventBus, BusObserver } from '@studnicky/dagonizer/progress';
 *
 * const bus = EventBus.of();
 * const dispatcher = new Dagonizer<MyState>({
 *   observers: [new BusObserver(bus, 'dag-events')],
 * });
 * bus.subscribe('dag-events', (event) => { console.log(event.payload); });
 * ```
 */

import type { DispatcherObserverType } from '../Dagonizer.js';
import type { ExecutionResultType } from '../entities/execution/ExecutionResult.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { EventBus } from './EventBus.js';

/**
 * Discriminated union of all lifecycle event payloads published by `BusObserver`.
 *
 * State is intentionally excluded: state is a mutable reference and is not safe
 * to publish to multiple independent subscribers. Include only string/primitive
 * fields so every subscriber receives a stable snapshot of the event's identity.
 */
export type DagLifecycleEventType =
  | { readonly event: 'flowStart';  readonly dagName: string }
  | { readonly event: 'flowEnd';    readonly dagName: string; readonly outcome: string }
  | { readonly event: 'nodeStart';  readonly nodeName: string; readonly placementPath: readonly string[] }
  | { readonly event: 'nodeEnd';    readonly nodeName: string; readonly output: string | null; readonly placementPath: readonly string[] }
  | { readonly event: 'nodeError';  readonly nodeName: string; readonly error: string; readonly placementPath: readonly string[] }
  | { readonly event: 'phaseEnter'; readonly dagName: string; readonly phase: string; readonly placementName: string }
  | { readonly event: 'phaseExit';  readonly dagName: string; readonly phase: string; readonly placementName: string };

/**
 * `DispatcherObserverType` implementation that publishes each lifecycle event
 * as a `DagLifecycleEventType` payload to a named `EventBus` topic.
 *
 * Pass a `BusObserver` in `DagonizerOptionsType.observers[]` to decouple the
 * dispatcher from downstream consumers. Multiple subscribers on the same topic
 * all receive the same event independently.
 *
 * State is never included in the payload — it is a mutable reference and not
 * safe to broadcast across subscriber boundaries. Only string/primitive fields
 * are published.
 *
 * V8 shape: both instance fields are initialised in the constructor in
 * declaration order. The hidden class is stable across all `BusObserver` instances.
 */
export class BusObserver implements DispatcherObserverType {
  readonly #bus: EventBus;
  readonly #topic: string;

  constructor(bus: EventBus, topic: string) {
    this.#bus = bus;
    this.#topic = topic;
  }

  onFlowStart(dagName: string, _state: NodeStateInterface): void {
    void this.#bus.publish(this.#topic, { 'event': 'flowStart', 'dagName': dagName } satisfies DagLifecycleEventType);
  }

  onFlowEnd(dagName: string, _state: NodeStateInterface, result: ExecutionResultType<NodeStateInterface>): void {
    const outcome = result.terminalOutcome ?? result.interruptedAt?.reason ?? 'none';
    void this.#bus.publish(this.#topic, { 'event': 'flowEnd', 'dagName': dagName, 'outcome': outcome } satisfies DagLifecycleEventType);
  }

  onNodeStart(nodeName: string, _state: NodeStateInterface, placementPath: readonly string[]): void {
    void this.#bus.publish(this.#topic, { 'event': 'nodeStart', 'nodeName': nodeName, 'placementPath': placementPath } satisfies DagLifecycleEventType);
  }

  onNodeEnd(nodeName: string, output: string | null, _state: NodeStateInterface, placementPath: readonly string[]): void {
    void this.#bus.publish(this.#topic, { 'event': 'nodeEnd', 'nodeName': nodeName, 'output': output, 'placementPath': placementPath } satisfies DagLifecycleEventType);
  }

  onError(nodeName: string, error: Error, _state: NodeStateInterface, placementPath: readonly string[]): void {
    void this.#bus.publish(this.#topic, { 'event': 'nodeError', 'nodeName': nodeName, 'error': error.message, 'placementPath': placementPath } satisfies DagLifecycleEventType);
  }

  onPhaseEnter(dagName: string, phase: 'pre' | 'post', placementName: string, _state: NodeStateInterface, _placementPath: readonly string[]): void {
    void this.#bus.publish(this.#topic, { 'event': 'phaseEnter', 'dagName': dagName, 'phase': phase, 'placementName': placementName } satisfies DagLifecycleEventType);
  }

  onPhaseExit(dagName: string, phase: 'pre' | 'post', placementName: string, _state: NodeStateInterface, _placementPath: readonly string[]): void {
    void this.#bus.publish(this.#topic, { 'event': 'phaseExit', 'dagName': dagName, 'phase': phase, 'placementName': placementName } satisfies DagLifecycleEventType);
  }
}
