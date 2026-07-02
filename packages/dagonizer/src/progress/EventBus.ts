/**
 * EventBus: DAG progress bus.
 *
 * Extends `@studnicky/event-bus`'s `EventBus`, fixing the topic map so every
 * topic carries a `BusEventEnvelopeType<unknown>` payload. Publish wraps the
 * caller's raw payload in an envelope (topic, payload, `Date.now()`
 * timestamp) before handing it to the inherited typed async pub/sub.
 *
 * Delivery goes through a per-subscriber `BusQueue`: a bounded FIFO queue
 * that isolates one subscriber's errors and pacing from every other
 * subscriber. A slow subscriber's queue fills toward its high-water mark and
 * `publish()` applies backpressure (its returned promise stays pending)
 * instead of delivering synchronously with no bound, or dropping events.
 *
 * Usage:
 * ```ts
 * const bus = EventBus.of();
 * const unsub = bus.subscribe('runs', (event) => { console.log(event.payload); });
 * await bus.publish('runs', { nodeId: 'a' });
 * unsub(); // deregister
 * await bus.close(); // stop delivery on every topic, drain in-flight queues
 * ```
 */

import { EventBus as SubstrateEventBus } from '@studnicky/event-bus';
import type { EventHandlerType, UnsubscribeType } from '@studnicky/event-bus';

import type { BusEventEnvelopeType } from './BusEventEnvelope.js';
import { BusEventEnvelopeBuilder } from './BusEventEnvelope.js';

/** Topic map for the progress bus: every topic carries a `BusEventEnvelopeType<unknown>` payload. */
export type BusTopicMapType = Record<string, BusEventEnvelopeType<unknown>>;

/**
 * Handler for a subscribed topic. Receives the envelope and the
 * subscription's `AbortSignal` (aborts on unsubscribe, caller-signal abort,
 * or bus close).
 */
export type BusListenerType = EventHandlerType<BusEventEnvelopeType<unknown>>;

/**
 * Class-shape interface for `EventBus`.
 *
 * Describes the public surface: `publish`, `subscribe`, `drain`, `close`.
 * Lives in the same file as the class per the three-tier taxonomy.
 */
export interface EventBusInterface {
  /**
   * Wrap `payload` in a `BusEventEnvelopeType` and publish it to every
   * subscriber on `topic`. Resolves once every subscriber queue has accepted
   * the event (backpressure delays resolution when a queue is at its
   * high-water mark).
   */
  publish(topic: string, payload: unknown): Promise<void>;
  /**
   * Subscribe to `topic`. The handler receives a `BusEventEnvelopeType<unknown>`
   * and the subscription's `AbortSignal`. Returns a zero-arg unsubscribe handle.
   */
  subscribe(topic: string, handler: BusListenerType, options?: { 'signal'?: AbortSignal }): UnsubscribeType;
  /** Wait for every subscriber queue to empty. */
  drain(): Promise<void>;
  /** Stop delivery on every topic and drain in-flight subscriber queues. */
  close(): Promise<void>;
}

/**
 * DAG progress bus. Extends `@studnicky/event-bus`'s `EventBus`, fixing the
 * topic map to `BusTopicMapType` so every topic shares the same envelope
 * payload shape.
 *
 * V8 shape: no additional instance fields beyond the base class; the hidden
 * class is the base class's hidden class.
 */
export class EventBus extends SubstrateEventBus<BusTopicMapType> implements EventBusInterface {
  /** Materialise a `EventBus` fixed to `BusTopicMapType`. The base class's protected constructor forces this factory. */
  static of(): EventBus {
    const result = new this();
    return result;
  }

  /**
   * Wrap `payload` in a `BusEventEnvelopeType` (topic, payload, `Date.now()`
   * timestamp) and publish it to every subscriber on `topic`.
   */
  override async publish(topic: string, payload: unknown): Promise<void> {
    const envelope = BusEventEnvelopeBuilder.of(topic, payload);
    await super.publish(topic, envelope);
  }
}
