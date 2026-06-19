/**
 * MessageChannelInterface: duplex channel between parent dispatcher and DagHost.
 *
 * Adapter contract. Implementations include LoopbackChannel (in-memory,
 * testing), MessagePortChannel (worker threads), IpcChannel (child process),
 * NdjsonChannel (stdio, polyglot).
 *
 * `send`      — deliver a message to the peer. Fire-and-forget.
 * `onMessage` — register the inbound message handler. Called once; the
 *               channel holds a single handler. Replacing the handler
 *               replaces the previous one.
 * `close`     — sever the channel. No further messages are delivered;
 *               outstanding send calls are silently dropped.
 */

import type { BridgeMessageType } from '../entities/executor/BridgeMessage.js';

export interface MessageChannelInterface {
  /** Send a message to the peer. Fire-and-forget; does not throw. */
  send(message: BridgeMessageType): void;
  /** Register the inbound message handler. Replaces any previous handler. */
  onMessage(handler: (message: BridgeMessageType) => void): void;
  /** Close the channel; severs both send and receive. */
  close(): void;
}
