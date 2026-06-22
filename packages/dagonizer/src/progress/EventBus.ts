/**
 * EventBus: in-process, synchronous, topic-keyed publish/subscribe.
 *
 * Domain-free. No persistence, no Node.js-only APIs. Isomorphic (runs in
 * browser and Node). Zero external dependencies.
 *
 * Each subscriber receives a fully-typed `BusEventEnvelopeInterface<TPayload>`
 * on every publish to its topic. Delivery is synchronous (listeners fire in
 * subscription order before `publish` returns). A throwing listener is caught
 * and does not prevent subsequent listeners from being called.
 *
 * Usage:
 * ```ts
 * const bus = new EventBus();
 * const unsub = bus.subscribe('runs', (event) => console.log(event.payload));
 * bus.publish('runs', { nodeId: 'a' });
 * unsub(); // deregister
 * bus.clear('runs'); // drop all listeners on one topic
 * bus.dispose(); // drop all listeners on all topics
 * ```
 */

import type { BusEventEnvelopeType } from './BusEventEnvelope.js';
import { BusEventEnvelopeBuilder } from './BusEventEnvelope.js';

/** A listener callback invoked for each event published on a topic. */
export type BusListenerType<TPayload = unknown> = (
  event: BusEventEnvelopeType<TPayload>,
) => void;

/** Function returned by `EventBus.subscribe` that removes the listener when called. */
export type BusUnsubscribeType = () => void;

/**
 * Class-shape interface for `EventBus`.
 *
 * Describes the public surface: `publish`, `subscribe`, `clear`, `dispose`.
 * Lives in the same file as the class per the three-tier taxonomy.
 */
export interface EventBusInterface {
  /**
   * Publish `payload` to all listeners on `topic`. The payload is `unknown`:
   * the bus cannot statically correlate a topic to a payload shape, so
   * subscribers narrow what they receive. This keeps storage and delivery
   * cast-free.
   */
  publish(topic: string, payload: unknown): void;
  /** Subscribe to `topic`. The listener receives `BusEventEnvelopeType` (payload `unknown`). Returns a zero-arg unsubscribe handle. */
  subscribe(topic: string, listener: BusListenerType): BusUnsubscribeType;
  /** Remove all listeners for `topic`. */
  clear(topic: string): void;
  /** Remove all listeners on every topic. Renders the bus inert. */
  dispose(): void;
}

/**
 * In-process topic-keyed event bus.
 *
 * V8 shape: `#listeners` is the only instance property, initialised in the
 * constructor. The hidden class is stable across all `EventBus` instances.
 */
export class EventBus implements EventBusInterface {
  readonly #listeners: Map<string, Set<BusListenerType>>;

  constructor() {
    this.#listeners = new Map();
  }

  /**
   * Publish `payload` to all listeners on `topic`.
   *
   * Delivery is synchronous. A listener that throws is caught and ignored so
   * that subsequent listeners still receive the event.
   */
  publish(topic: string, payload: unknown): void {
    const bucket = this.#listeners.get(topic);
    if (bucket === undefined || bucket.size === 0) return;

    const envelope = BusEventEnvelopeBuilder.of(topic, payload);
    for (const listener of bucket) {
      try {
        listener(envelope);
      } catch {
        // Swallow: one misbehaving listener must not starve the rest.
      }
    }
  }

  /**
   * Subscribe to `topic`. The listener receives a `BusEventEnvelopeType` whose
   * `payload` is `unknown` on each publish; narrow it inside the listener.
   *
   * Returns a zero-arg function that removes the listener.
   */
  subscribe(topic: string, listener: BusListenerType): BusUnsubscribeType {
    let bucket = this.#listeners.get(topic);
    if (bucket === undefined) {
      bucket = new Set();
      this.#listeners.set(topic, bucket);
    }
    bucket.add(listener);

    return (): void => {
      this.#listeners.get(topic)?.delete(listener);
    };
  }

  /** Remove all listeners for `topic`. A no-op when the topic has no listeners. */
  clear(topic: string): void {
    this.#listeners.delete(topic);
  }

  /** Remove all listeners on every topic. After this call the bus is inert. */
  dispose(): void {
    this.#listeners.clear();
  }
}
