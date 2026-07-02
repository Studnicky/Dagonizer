/**
 * `@studnicky/dagonizer/progress` — transport-agnostic progress substrate.
 *
 * Exports:
 * - `BusEventEnvelopeSchema` / `BusEventEnvelopeWireType` / `BusEventEnvelopeType<T>` / `BusEventEnvelopeBuilder`
 * - `EventBus` / `EventBusInterface` / `BusListenerType` / `BusTopicMapType`
 * - `UnsubscribeType` (re-exported from `@studnicky/event-bus`)
 * - `SseStream` / `SseStreamOptionsType`
 * - `BusObserver` / `DagLifecycleEventType`
 */

export type { UnsubscribeType } from '@studnicky/event-bus';

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
  BusTopicMapType,
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
