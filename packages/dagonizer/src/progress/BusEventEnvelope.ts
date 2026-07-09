/**
 * BusEventEnvelope: the wire shape for every event published on an `EventBus`.
 *
 * Every bus message is wrapped in this envelope. The `topic` field is the
 * routing key. The `payload` field carries the application value — opaque at
 * the bus layer and narrowed at each subscriber's call site.
 *
 * Schema + derived type follow the standard entity pattern: `*Schema` value
 * (JSON Schema 2020-12) + `FromSchema`-derived TypeScript type + narrowing
 * type when the generic parameter cannot be expressed in JSON Schema.
 */

import { Clock as SubstrateClock, RealTimeClockProvider } from '@studnicky/clock';
import type { FromSchema } from 'json-schema-to-ts';

const eventEnvelopeClock = SubstrateClock.create(RealTimeClockProvider.create());

export const BusEventEnvelopeSchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/BusEventEnvelope',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'object',
  'required': ['topic', 'payload', 'timestamp'],
  'properties': {
    'topic': { 'type': 'string', 'minLength': 1 },
    'payload': {},
    'timestamp': { 'type': 'number' },
  },
  'additionalProperties': false,
} as const;

/**
 * Wire type derived from `BusEventEnvelopeSchema` via `json-schema-to-ts`.
 * `payload` is `unknown` at the wire boundary — subscribers narrow it to
 * their expected type.
 */
export type BusEventEnvelopeWireType = FromSchema<typeof BusEventEnvelopeSchema>;

/**
 * Typed bus event envelope.
 *
 * `TPayload` narrows the `payload` field to the publisher's concrete value
 * type. The envelope is immutable at the consumer boundary; all fields are
 * initialised at construction time and never mutated.
 */
export type BusEventEnvelopeType<TPayload = unknown> = {
  /** Routing key — the topic this event was published on. */
  readonly 'topic': string;
  /** Application value published by the sender. */
  readonly 'payload': TPayload;
  /** Unix epoch milliseconds at publish time. */
  readonly 'timestamp': number;
};

/**
 * Static factory for `BusEventEnvelopeType<TPayload>`.
 *
 * Property order (topic, payload, timestamp) is fixed for V8 shape stability:
 * every instance shares the same hidden class.
 */
export class BusEventEnvelope {
  private constructor() { /* static class */ }

  /** Wrap `payload` in a typed envelope for `topic`. Timestamp defaults to the package clock. */
  static create<TPayload>(
    topic: string,
    payload: TPayload,
    options: { timestamp?: number } = {},
  ): BusEventEnvelopeType<TPayload> {
    return { 'topic': topic, 'payload': payload, 'timestamp': options.timestamp ?? eventEnvelopeClock.now() };
  }
}
