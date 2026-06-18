/**
 * BaseMessageChannel: shared abstract base for every `MessageChannelInterface`
 * transport.
 *
 * The four concrete channels (executor-node `IpcChannel`, `MessagePortChannel`,
 * `NdjsonChannel`; executor-web `PostMessageChannel`) all hold the same inbound
 * state — a single replaceable `#handler` and a `#closed` latch — and guard
 * delivery the same way: drop the message when closed or when no handler is
 * registered, otherwise hand it to the current handler. This base owns that
 * state and the guarded dispatch; a concrete channel supplies only its
 * transport `send` and subscribes its underlying endpoint to `dispatch`.
 *
 * All fields are initialised in the constructor in declaration order for V8
 * hidden-class stability; nothing is added or deleted after construction.
 *
 * Subclass contract:
 *   - implement `send(message)` — the transport-specific delivery.
 *   - subscribe the underlying endpoint once at construction and route every
 *     validated inbound `BridgeMessage` through `this.dispatch(message)`.
 *   - read `this.closed` to short-circuit transport callbacks early when the
 *     channel has been severed.
 */

import type { MessageChannelInterface } from '../contracts/MessageChannelInterface.js';
import type { BridgeMessage } from '../entities/executor/BridgeMessage.js';

export abstract class BaseMessageChannel implements MessageChannelInterface {
  #handler: ((message: BridgeMessage) => void) | null;
  #closed: boolean;

  protected constructor() {
    this.#handler = null;
    this.#closed = false;
  }

  /** Transport-specific delivery to the peer. Fire-and-forget; does not throw. */
  abstract send(message: BridgeMessage): void;

  /** Replace the inbound message handler. Single-handler replace semantics. */
  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  /**
   * Close the channel. No further inbound messages are delivered and the
   * handler is released. The transport's own resource teardown (listeners,
   * streams, process lifecycle) stays with the subclass `close` override,
   * which calls `super.close()` to flip the latch.
   */
  close(): void {
    this.#closed = true;
    this.#handler = null;
  }

  /** Whether the channel has been closed. Subclasses gate transport callbacks on this. */
  protected get closed(): boolean {
    return this.#closed;
  }

  /**
   * Guarded delivery of an inbound message. Drops the message when the channel
   * is closed or no handler is registered; otherwise forwards it to the current
   * handler. Subclasses route every validated inbound `BridgeMessage` here.
   */
  protected dispatch(message: BridgeMessage): void {
    const handler = this.#handler;
    if (handler !== null && !this.#closed) {
      handler(message);
    }
  }
}
