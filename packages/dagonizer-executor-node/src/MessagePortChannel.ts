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

import { BaseMessageChannel } from '@studnicky/dagonizer/container';
import { BridgeMessageBuilder } from '@studnicky/dagonizer/entities';
import type { BridgeMessage } from '@studnicky/dagonizer/entities';
import { Validator } from '@studnicky/dagonizer/validation';

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

export class MessagePortChannel extends BaseMessageChannel {
  readonly #port: MessagePortLike;

  constructor(port: MessagePortLike) {
    super();
    this.#port = port;

    // Install exactly one underlying transport listener for the channel's
    // lifetime. Inbound messages route through the base's guarded dispatch.
    // onMessage() replaces the base handler — it never re-subscribes to the port.
    this.#port.on('message', (value) => {
      if (this.closed) return;
      // Validate-and-narrow at the ingest boundary: the type predicate narrows
      // with zero casts; malformed payloads surface as an error BridgeMessage.
      if (Validator.bridgeMessage.is(value)) {
        this.dispatch(value);
      } else {
        this.dispatch(BridgeMessageBuilder.invalid(
          'INVALID_MESSAGE',
          'Received a message that does not conform to BridgeMessage schema',
        ));
      }
    });
  }

  override send(message: BridgeMessage): void {
    if (this.closed) return;
    this.#port.postMessage(message);
  }

  override close(): void {
    super.close();
    this.#port.close();
  }
}
