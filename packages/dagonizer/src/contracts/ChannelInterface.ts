/**
 * ChannelInterface: adapter contract for publishing completed-DAG hand-off
 * envelopes to a downstream transport.
 *
 * Implementations provide `publish(handoff)` to deliver the envelope to a
 * queue, message bus, or loopback store. Channels MUST NOT throw out of the
 * dispatcher; transport errors are the channel's responsibility to collect
 * or log internally.
 *
 * `destroy()` is optional. Implement it to release pool resources (open
 * connections, worker threads, etc.) when the dispatcher shuts down.
 */

import type { DAGHandoff } from '../entities/handoff/DAGHandoff.js';

export interface ChannelInterface {
  /**
   * Publish a completed-DAG hand-off envelope to the underlying transport.
   * Must not throw out of the dispatcher; any internal transport error is
   * the implementation's responsibility. The dispatcher wraps every
   * `publish` call in a try/catch regardless.
   */
  publish(handoff: DAGHandoff): Promise<void>;

  /**
   * Release transport resources. Called by consumers on shutdown. Optional:
   * channels without persistent resources need not implement it.
   */
  destroy?(): Promise<void>;
}
