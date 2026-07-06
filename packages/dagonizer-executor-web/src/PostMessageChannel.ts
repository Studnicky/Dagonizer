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

import { BaseMessageChannel } from '@studnicky/dagonizer/container';
import { BridgeMessage } from '@studnicky/dagonizer/entities';
import type { BridgeMessageType } from '@studnicky/dagonizer/entities';
import { Validator } from '@studnicky/dagonizer/validation';

import type { WebWorkerLikeInterface, WorkerScopeLikeInterface } from './WebWorkerLike.js';

// ---------------------------------------------------------------------------
// PostMessageEndpoint — union accepted by the constructor
// ---------------------------------------------------------------------------

/** Endpoints this channel can wrap: a main-thread worker or an inside-worker scope. */
export type PostMessageEndpointType = WebWorkerLikeInterface | WorkerScopeLikeInterface;

// ---------------------------------------------------------------------------
// PostMessageChannel
// ---------------------------------------------------------------------------

/**
 * BridgeMessage channel over a `postMessage` / `addEventListener` endpoint.
 *
 * Constructor DI: the endpoint is passed in; this class never constructs
 * a Worker or accesses `self` / global references.
 */
export class PostMessageChannel extends BaseMessageChannel {
  readonly #endpoint: PostMessageEndpointType;

  constructor(endpoint: PostMessageEndpointType) {
    super();
    this.#endpoint = endpoint;

    // Subscribe to inbound messages at construction time.
    // The listener is held on the endpoint; it routes through the base's
    // guarded dispatch, so replacing the handler (via onMessage) never
    // requires re-subscribing.
    this.#endpoint.addEventListener('message', (event) => {
      this.#handleInbound(event.data);
    });
  }

  override send(message: BridgeMessageType): void {
    if (this.closed) return;
    this.#endpoint.postMessage(message);
  }

  // ---------------------------------------------------------------------------
  // Inbound boundary
  // ---------------------------------------------------------------------------

  #handleInbound(data: unknown): void {
    if (this.closed) return;

    let message: BridgeMessageType;
    try {
      message = Validator.bridgeMessage.validate(data);
    } catch {
      // Invalid payload: surface as an error message to the handler.
      // This keeps the channel alive and lets the DagHost or DagContainerBase
      // surface the failure rather than silently swallowing it.
      this.dispatch(BridgeMessage.create({
        'code': 'INVALID_MESSAGE',
        'message': 'PostMessageChannel received a payload that does not conform to BridgeMessage schema',
      }));
      return;
    }

    this.dispatch(message);
  }
}
