/**
 * LoopbackChannel: in-memory channel pair for testing.
 *
 * `LoopbackChannel.pair()` returns two `MessageChannelInterface` instances.
 * Sending on one delivers a structuredClone of the message to the other's
 * handler via setImmediate (preserving async delivery semantics without
 * platform I/O).
 *
 * `close()` severs both directions; messages sent after close are silently
 * dropped.
 *
 * Test-only: no runtime imports from dist; types only.
 */

import type { MessageChannelInterface } from '../dist/contracts/MessageChannelInterface.js';
import type { BridgeMessage } from '../dist/entities/executor/BridgeMessage.js';

class LoopbackSide implements MessageChannelInterface {
  #handler: ((message: BridgeMessage) => void) | null;
  #peer: LoopbackSide | null;
  #closed: boolean;

  constructor() {
    this.#handler = null;
    this.#peer = null;
    this.#closed = false;
  }

  /** Connect this side to its peer. Called once by pair(). */
  connect(peer: LoopbackSide): void {
    this.#peer = peer;
  }

  send(message: BridgeMessage): void {
    if (this.#closed) return;
    const peer = this.#peer;
    if (peer === null || peer.#closed) return;
    const cloned = structuredClone(message) as BridgeMessage;
    const handler = peer.#handler;
    if (handler !== null) {
      // Schedule delivery asynchronously — preserves async semantics without
      // platform I/O. setImmediate is available in the project's eslint globals.
      setImmediate(() => {
        if (!peer.#closed) {
          handler(cloned);
        }
      });
    }
  }

  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#closed = true;
    // Sever the peer reference to allow GC.
    this.#peer = null;
  }
}

/**
 * In-memory duplex channel pair. Each side implements MessageChannelInterface.
 *
 * Sending on side[0] delivers to side[1]'s handler, and vice versa.
 * `close()` on either side severs both directions.
 */
export class LoopbackChannel {
  private constructor() { /* static class */ }

  /**
   * Create a connected pair of channel ends.
   * Returns `[parentSide, hostSide]` by convention:
   *   parentSide — passed to DagContainerBase (or test parent)
   *   hostSide   — passed to DagHost
   */
  static pair(): readonly [MessageChannelInterface, MessageChannelInterface] {
    const a = new LoopbackSide();
    const b = new LoopbackSide();
    a.connect(b);
    b.connect(a);
    return [a, b] as const;
  }
}
