/**
 * PostMessageChannel: MessageChannelInterface over a postMessage endpoint.
 *
 * Wraps either a WebWorkerLikeInterface (main-thread side) or a
 * WorkerScopeLikeInterface (worker-side), adapting their `postMessage` /
 * `addEventListener('message')` surface to the BridgeMessage duplex channel
 * contract.
 *
 * Inbound event.data is the JSON-ingest boundary: every payload is narrowed
 * via `Validator.bridgeMessage.validate`. Invalid payloads surface as an
 * 'error' message to the registered handler — they never throw to the
 * endpoint's message event.
 *
 * All properties initialised in constructor for V8 shape stability.
 */

import type { MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import { BridgeMessageBuilder } from '@noocodex/dagonizer/entities';
import type { BridgeMessage } from '@noocodex/dagonizer/entities';
import { Validator } from '@noocodex/dagonizer/validation';

import type { WebWorkerLikeInterface, WorkerScopeLikeInterface } from './WebWorkerLike.js';

// ---------------------------------------------------------------------------
// PostMessageEndpoint — union accepted by the constructor
// ---------------------------------------------------------------------------

/** Endpoints this channel can wrap: a main-thread worker or an inside-worker scope. */
export type PostMessageEndpoint = WebWorkerLikeInterface | WorkerScopeLikeInterface;

// ---------------------------------------------------------------------------
// PostMessageChannel
// ---------------------------------------------------------------------------

/**
 * BridgeMessage channel over a `postMessage` / `addEventListener` endpoint.
 *
 * Constructor DI: the endpoint is passed in; this class never constructs
 * a Worker or accesses `self` / global references.
 */
export class PostMessageChannel implements MessageChannelInterface {
  readonly #endpoint: PostMessageEndpoint;
  #handler: ((message: BridgeMessage) => void) | null;
  #closed: boolean;

  constructor(endpoint: PostMessageEndpoint) {
    this.#endpoint = endpoint;
    this.#handler = null;
    this.#closed = false;

    // Subscribe to inbound messages at construction time.
    // The listener is held on the endpoint; it references this.#handler so
    // replacing the handler (via onMessage) does not require re-subscribing.
    this.#endpoint.addEventListener('message', (event) => {
      this.#handleInbound(event.data);
    });
  }

  send(message: BridgeMessage): void {
    if (this.#closed) return;
    this.#endpoint.postMessage(message);
  }

  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#closed = true;
    this.#handler = null;
  }

  // ---------------------------------------------------------------------------
  // Inbound boundary
  // ---------------------------------------------------------------------------

  #handleInbound(data: unknown): void {
    if (this.#closed) return;
    const handler = this.#handler;
    if (handler === null) return;

    let message: BridgeMessage;
    try {
      message = Validator.bridgeMessage.validate(data);
    } catch {
      // Invalid payload: surface as an error message to the handler.
      // This keeps the channel alive and lets the DagHost or DagContainerBase
      // surface the failure rather than silently swallowing it.
      handler(BridgeMessageBuilder.invalid(
        'INVALID_MESSAGE',
        'PostMessageChannel received a payload that does not conform to BridgeMessage schema',
      ));
      return;
    }

    handler(message);
  }
}
