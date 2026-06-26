/**
 * `@studnicky/dagonizer/progress` — transport-agnostic progress substrate.
 *
 * Exports:
 * - `BusEventEnvelopeSchema` / `BusEventEnvelopeWireType` / `BusEventEnvelopeType<T>` / `BusEventEnvelopeBuilder`
 * - `EventBus` / `EventBusInterface` / `BusListenerType` / `BusUnsubscribeType`
 * - `SseStream` / `SseStreamOptionsType`
 * - `BusObserver` / `DagLifecycleEventType`
 */

export {
  BusEventEnvelopeBuilder,
  BusEventEnvelopeSchema,
} from './BusEventEnvelope.js';
export type {
  BusEventEnvelopeType,
  BusEventEnvelopeWireType,
} from './BusEventEnvelope.js';

export {
  EventBus,
} from './EventBus.js';
export type {
  BusListenerType,
  BusUnsubscribeType,
  EventBusInterface,
} from './EventBus.js';

export {
  SseStream,
} from './SseStream.js';
export type {
  SseStreamOptionsType,
} from './SseStream.js';

export {
  BroadcastChannelGlobal,
  BroadcastChannelRelay,
} from './BroadcastChannelRelay.js';
export type {
  BroadcastChannelConstructorLikeInterface,
  BroadcastChannelLikeInterface,
  BroadcastChannelRelayInterface,
  BroadcastChannelRelayOptionsType,
} from './BroadcastChannelRelay.js';

export {
  BusObserver,
} from './BusObserver.js';
export type {
  DagLifecycleEventType,
} from './BusObserver.js';
