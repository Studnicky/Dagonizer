/**
 * MessagePortChannel: MessageChannelInterface over a node:worker_threads MessagePort.
 *
 * Usable from both the parent side (MessagePort from worker.port) and the
 * worker side (parentPort from worker_threads). The constructor accepts any
 * object implementing the structural MessagePort shape.
 *
 * send    → port.postMessage(message)
 * onMessage → port.on('message', handler)
 * close   → port.close()
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import type { MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import type { BridgeMessage } from '@noocodex/dagonizer/entities';
import { Validator } from '@noocodex/dagonizer/validation';

// ---------------------------------------------------------------------------
// MessagePortLike: structural shape for injectable port (enables testing)
// ---------------------------------------------------------------------------

export interface MessagePortLike {
  postMessage(value: unknown): void;
  on(event: 'message', listener: (value: unknown) => void): this;
  close(): void;
}

// ---------------------------------------------------------------------------
// MessagePortChannel
// ---------------------------------------------------------------------------

export class MessagePortChannel implements MessageChannelInterface {
  readonly #port: MessagePortLike;
  #handler: ((message: BridgeMessage) => void) | null;
  #closed: boolean;

  constructor(port: MessagePortLike) {
    this.#port = port;
    this.#handler = null;
    this.#closed = false;

    // Install exactly one underlying transport listener for the channel's
    // lifetime. Inbound messages are delegated to this.#handler when set.
    // onMessage() replaces this.#handler — it never re-subscribes to the port.
    this.#port.on('message', (value) => {
      if (this.#closed) return;
      const handler = this.#handler;
      if (handler === null) return;
      // Validate-and-narrow at the ingest boundary: the type predicate narrows
      // with zero casts; malformed payloads surface as an error BridgeMessage.
      if (Validator.bridgeMessage.is(value)) {
        handler(value);
      } else {
        handler({
          'kind': 'error',
          'requestId': null,
          'code': 'INVALID_MESSAGE',
          'message': 'Received a message that does not conform to BridgeMessage schema',
          'recoverable': true,
        });
      }
    });
  }

  send(message: BridgeMessage): void {
    if (this.#closed) return;
    this.#port.postMessage(message);
  }

  /** Replace the inbound message handler. Single-handler replace semantics. */
  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#closed = true;
    this.#handler = null;
    this.#port.close();
  }
}
