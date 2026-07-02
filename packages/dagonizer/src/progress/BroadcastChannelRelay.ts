/**
 * BroadcastChannelRelay: bridges a local `EventBus` to/from a browser
 * `BroadcastChannel`, so harness progress events flow across browser contexts
 * (main↔worker, cross-tab) with no server.
 *
 * This is the cross-context analog of `SseStream` (which bridges an EventBus
 * to an HTTP Server-Sent-Events stream). It is a transport, not an
 * `ObserverRelayInterface` implementer.
 *
 * The browser `BroadcastChannel` global is reached via `Reflect.get` +
 * the `BroadcastChannelGlobal.is` structural type-predicate guard — never by
 * bare identifier — so this module carries zero DOM-lib dependency.
 *
 * Echo suppression: a message arriving on the channel republishes onto the
 * local bus. `EventBus.publish` resolves only after every subscriber queue
 * (including the relay's own outbound subscription) has accepted the event,
 * so setting `#suppressOutbound = true` before `await`-ing the republish and
 * resetting it in a `finally` block reliably prevents the inbound event from
 * echoing back out over the channel.
 *
 * Usage:
 * ```ts
 * const bus = EventBus.of();
 * // inject an already-constructed channel (e.g. for tests):
 * const relay = BroadcastChannelRelay.of(bus, ['dag-events'], channel);
 * // or resolve from globalThis (browser / worker):
 * const relay = BroadcastChannelRelay.open(bus, ['dag-events'], 'dag-events');
 * relay.close(); // unsubscribe + close the channel
 * ```
 */

import type { EventBusInterface } from './EventBus.js';

// ---------------------------------------------------------------------------
// BroadcastChannelLikeInterface
// ---------------------------------------------------------------------------

/**
 * Structural subset of the real `BroadcastChannel` API covering only the
 * members called by `BroadcastChannelRelay`.
 *
 * The real browser `BroadcastChannel` and any structural mock are assignable
 * here without a cast. Consumers never import DOM types — this interface is
 * the boundary.
 */
export interface BroadcastChannelLikeInterface {
  /** Post a message to all other contexts joined to the same channel name. */
  postMessage(message: unknown): void;
  /** Register a `message` event handler. */
  addEventListener(
    type: 'message',
    listener: (event: { readonly 'data': unknown }) => void,
  ): void;
  /** Remove a previously registered `message` event handler. */
  removeEventListener(
    type: 'message',
    listener: (event: { readonly 'data': unknown }) => void,
  ): void;
  /** Close the channel and release its resources. */
  close(): void;
  /** The channel name supplied to the constructor. */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// BroadcastChannelConstructorLikeInterface
// ---------------------------------------------------------------------------

/**
 * Constructor signature for the `BroadcastChannel` global.
 *
 * Used by `BroadcastChannelGlobal.is` to narrow the `globalThis` value
 * to something that can be `new`-called to produce a `BroadcastChannelLikeInterface`.
 */
export interface BroadcastChannelConstructorLikeInterface {
  new (name: string): BroadcastChannelLikeInterface;
}

// ---------------------------------------------------------------------------
// BroadcastChannelGlobal: structural type-predicate guard
// ---------------------------------------------------------------------------

/**
 * Static utilities for the `BroadcastChannel` global boundary.
 *
 * `BroadcastChannelGlobal.is(x)` narrows `unknown →
 * BroadcastChannelConstructorLikeInterface` via a structural type-predicate.
 * The guard body is cast-free: it narrows with `typeof` and the `in`
 * operator, which TypeScript uses to refine the value's type at each step.
 * After `if (BroadcastChannelGlobal.is(x))` the value is narrowed.
 */
export class BroadcastChannelGlobal {
  private constructor() { /* static class */ }

  /**
   * Structural type-guard: narrows `unknown → BroadcastChannelConstructorLikeInterface`.
   *
   * Checks that `x` is a function with a `prototype` that has a `postMessage`
   * method — the distinguishing member of `BroadcastChannelLikeInterface`.
   */
  static is(x: unknown): x is BroadcastChannelConstructorLikeInterface {
    if (typeof x !== 'function') return false;
    if (!('prototype' in x)) return false;
    const proto = x.prototype;
    return (
      typeof proto === 'object' &&
      proto !== null &&
      'postMessage' in proto &&
      typeof proto.postMessage === 'function'
    );
  }
}

// ---------------------------------------------------------------------------
// BroadcastChannelRelayOptionsType
// ---------------------------------------------------------------------------

/**
 * Options for `BroadcastChannelRelay.of` and `BroadcastChannelRelay.open`.
 *
 * No speculative knobs. The shape is present for signature consistency with
 * other relays in this package.
 */
export type BroadcastChannelRelayOptionsType = Record<string, never>;

const BROADCAST_CHANNEL_RELAY_DEFAULTS: BroadcastChannelRelayOptionsType = {};

// ---------------------------------------------------------------------------
// BroadcastChannelRelayInterface
// ---------------------------------------------------------------------------

/**
 * Class-shape interface for `BroadcastChannelRelay`.
 *
 * Describes the public surface: `close`. Lives in the same file as the class
 * per the three-tier interface taxonomy (tier 1: class-shape interface).
 */
export interface BroadcastChannelRelayInterface {
  /** Unsubscribe from all bus topics, remove the channel message listener, and close the channel. Idempotent. */
  close(): void;
}

// ---------------------------------------------------------------------------
// BroadcastChannelRelay
// ---------------------------------------------------------------------------

/** Inbound message event shape accepted from the `BroadcastChannel`. */
type InboundMessageEventType = {
  readonly 'data': unknown;
};

/**
 * `BroadcastChannelRelay`: bridges a local `EventBus` to/from a browser
 * `BroadcastChannel`.
 *
 * Instantiate via `BroadcastChannelRelay.of(bus, topics, channel)` (inject a
 * channel, e.g. for tests) or `BroadcastChannelRelay.open(bus, topics,
 * channelName)` (resolve `BroadcastChannel` from `globalThis` at runtime).
 *
 * V8 shape: all instance properties are initialised in the constructor in
 * declaration order. The hidden class is stable across all
 * `BroadcastChannelRelay` instances.
 */
export class BroadcastChannelRelay implements BroadcastChannelRelayInterface {
  readonly #bus:            EventBusInterface;
  readonly #channel:        BroadcastChannelLikeInterface;
  readonly #topics:         ReadonlySet<string>;
  readonly #unsubscribers:  (() => void)[];
  readonly #onMessage:      (event: InboundMessageEventType) => void;
  #suppressOutbound:        boolean;
  #closed:                  boolean;

  protected constructor(
    bus:     EventBusInterface,
    topics:  readonly string[],
    channel: BroadcastChannelLikeInterface,
    _options: BroadcastChannelRelayOptionsType,
  ) {
    this.#bus             = bus;
    this.#channel         = channel;
    this.#topics          = new Set(topics);
    this.#unsubscribers   = [];
    this.#suppressOutbound = false;
    this.#closed           = false;

    // Bind the inbound handler once so we can remove it by reference in close().
    this.#onMessage = (event: InboundMessageEventType): void => {
      void BroadcastChannelRelay.#handleInbound(this, event);
    };

    // Outbound: for each topic, subscribe on the bus and forward to channel.
    for (const topic of topics) {
      const unsub = bus.subscribe(topic, (envelope) => {
        if (this.#suppressOutbound) return;
        this.#channel.postMessage({ 'topic': envelope.topic, 'payload': envelope.payload, 'timestamp': envelope.timestamp });
      });
      this.#unsubscribers.push(unsub);
    }

    // Inbound: listen on the channel and republish onto the local bus.
    this.#channel.addEventListener('message', this.#onMessage);
  }

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  /**
   * Construct a relay by injecting an already-constructed channel.
   *
   * This factory is the primary testability seam: pass a structural mock
   * that implements `BroadcastChannelLikeInterface` without touching the
   * real browser global.
   *
   * @param bus     - The local event bus to bridge.
   * @param topics  - Topic names to subscribe on the bus and filter on inbound.
   * @param channel - An open `BroadcastChannelLikeInterface` instance.
   * @param options - Optional config (currently no knobs; present for shape consistency).
   */
  static of(
    bus:      EventBusInterface,
    topics:   readonly string[],
    channel:  BroadcastChannelLikeInterface,
    options:  BroadcastChannelRelayOptionsType = BROADCAST_CHANNEL_RELAY_DEFAULTS,
  ): BroadcastChannelRelay {
    return new BroadcastChannelRelay(bus, topics, channel, options);
  }

  /**
   * Resolve the browser `BroadcastChannel` global from `globalThis` via
   * `Reflect.get` + the `BroadcastChannelGlobal.is` structural guard, open a
   * channel with `channelName`, and return a new relay. Throws an `Error`
   * when `BroadcastChannel` is absent (non-browser/worker environment).
   *
   * @param bus         - The local event bus to bridge.
   * @param topics      - Topic names to subscribe on the bus and filter on inbound.
   * @param channelName - The `BroadcastChannel` name to open.
   * @param options     - Optional config (currently no knobs; present for shape consistency).
   */
  static open(
    bus:         EventBusInterface,
    topics:      readonly string[],
    channelName: string,
    options:     BroadcastChannelRelayOptionsType = BROADCAST_CHANNEL_RELAY_DEFAULTS,
  ): BroadcastChannelRelay {
    const raw = Reflect.get(globalThis, 'BroadcastChannel');
    if (!BroadcastChannelGlobal.is(raw)) {
      throw new Error(
        'BroadcastChannel is not available in this environment. ' +
        'Use BroadcastChannelRelay.of(...) with an injected channel for non-browser use.',
      );
    }
    const channel = new raw(channelName);
    return BroadcastChannelRelay.of(bus, topics, channel, options);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Unsubscribe from all bus topics, remove the channel `message` listener,
   * and close the channel. Idempotent — safe to call more than once.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers.length = 0;
    this.#channel.removeEventListener('message', this.#onMessage);
    this.#channel.close();
  }

  // ---------------------------------------------------------------------------
  // Private static helpers
  // ---------------------------------------------------------------------------

  /**
   * Validate that an inbound message `data` value is a structurally valid
   * `BusEventEnvelopeType`.
   *
   * Checks: non-null object, `topic` is a non-empty string, `payload` key is
   * present, `timestamp` is a number.
   */
  static #isEnvelope(data: unknown): data is { readonly 'topic': string; readonly 'payload': unknown; readonly 'timestamp': number } {
    if (typeof data !== 'object' || data === null) return false;
    if (!('topic' in data) || !('payload' in data) || !('timestamp' in data)) return false;
    return (
      typeof data.topic === 'string' &&
      data.topic.length > 0 &&
      typeof data.timestamp === 'number'
    );
  }

  /**
   * Handle an inbound `message` event from the channel.
   *
   * Validates the envelope, filters to known topics, sets the re-entrancy
   * suppression flag, awaits the republish on the bus (so every subscriber
   * queue — including the relay's own outbound subscription — has already
   * observed the flag), then resets the flag in a `finally`.
   */
  static async #handleInbound(relay: BroadcastChannelRelay, event: InboundMessageEventType): Promise<void> {
    const envelope = event['data'];
    if (!BroadcastChannelRelay.#isEnvelope(envelope)) return;
    if (!relay.#topics.has(envelope.topic)) return;

    relay.#suppressOutbound = true;
    try {
      await relay.#bus.publish(envelope.topic, envelope.payload);
    } finally {
      relay.#suppressOutbound = false;
    }
  }
}
