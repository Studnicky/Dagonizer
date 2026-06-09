/**
 * IpcChannel: MessageChannelInterface over child_process IPC.
 *
 * Accepts a structural endpoint so the same class serves both sides of the
 * IPC boundary:
 *
 *   Parent side:  new IpcChannel({ send: (m) => child.send(m), on: (e, fn) => child.on(e, fn) })
 *   Child side:   new IpcChannel({ send: (m) => process.send!(m), on: (e, fn) => process.on(e, fn) })
 *
 * send      → endpoint.send(message)
 * onMessage → endpoint.on('message', handler)
 * close     → mark closed; IPC channel lifecycle is managed by the process
 *
 * All properties initialised in constructor for V8 hidden-class stability.
 */

import type { MessageChannelInterface } from '@noocodex/dagonizer/contracts';
import { BridgeMessageBuilder } from '@noocodex/dagonizer/entities';
import type { BridgeMessage } from '@noocodex/dagonizer/entities';
import { Validator } from '@noocodex/dagonizer/validation';

// ---------------------------------------------------------------------------
// IpcEndpoint: structural shape injectable from parent or child side
// ---------------------------------------------------------------------------

export interface IpcEndpoint {
  send(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): this;
}

// ---------------------------------------------------------------------------
// IpcChannel
// ---------------------------------------------------------------------------

export class IpcChannel implements MessageChannelInterface {
  readonly #endpoint: IpcEndpoint;
  #handler: ((message: BridgeMessage) => void) | null;
  #closed: boolean;

  constructor(endpoint: IpcEndpoint) {
    this.#endpoint = endpoint;
    this.#handler = null;
    this.#closed = false;

    // Install exactly one underlying IPC listener for the channel's lifetime.
    // Inbound messages are delegated to this.#handler when set.
    // onMessage() replaces this.#handler — it never re-subscribes to the endpoint.
    this.#endpoint.on('message', (value) => {
      if (this.#closed) return;
      const handler = this.#handler;
      if (handler === null) return;
      // Validate-and-narrow at the IPC ingest boundary: the type predicate
      // narrows with zero casts; malformed payloads surface as an error message.
      if (Validator.bridgeMessage.is(value)) {
        handler(value);
      } else {
        handler(BridgeMessageBuilder.invalid(
          'INVALID_MESSAGE',
          'Received a message that does not conform to BridgeMessage schema',
        ));
      }
    });
  }

  send(message: BridgeMessage): void {
    if (this.#closed) return;
    this.#endpoint.send(message);
  }

  /** Replace the inbound message handler. Single-handler replace semantics. */
  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#closed = true;
    this.#handler = null;
    // IPC channel lifecycle belongs to the process; we only stop delivering.
  }
}
