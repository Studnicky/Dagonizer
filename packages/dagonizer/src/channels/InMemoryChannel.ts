/**
 * InMemoryChannel: local default and loopback `HandoffChannelInterface` implementation.
 *
 * Stores every published envelope in an in-memory array. The array is
 * accessed via the `published` readonly getter. Envelopes are deep-cloned on
 * publish via `structuredClone` to ensure full serialization fidelity —
 * the stored copy is independent from the dispatcher's internal state.
 *
 * Extension via subclass (zero callbacks): override the protected
 * `onPublished(handoff)` hook to chain a downstream DAG. It is awaited after
 * each envelope is recorded. Restore the envelope state and call the downstream
 * dispatcher's `execute` from the override. The default is a no-op.
 *
 * Constructor argument order: required positional (none), trailing options
 * object. V8 shape: all fields initialised in constructor in declaration order.
 */

import type { HandoffChannelInterface } from '../contracts/HandoffChannelInterface.js';
import type { DAGHandoff } from '../entities/handoff/DAGHandoff.js';

/**
 * Constructor options for `InMemoryChannel`. Currently carries no fields; the
 * type exists as the extension point for future channel configuration and to
 * keep the constructor's options-object shape canonical.
 */
export type InMemoryChannelOptions = Record<string, never>;

export class InMemoryChannel implements HandoffChannelInterface {
  #published: DAGHandoff[];

  constructor(_options: InMemoryChannelOptions = {}) {
    this.#published = [];
  }

  /** All published envelopes in publish order (deep-cloned on entry). */
  get published(): readonly DAGHandoff[] {
    return this.#published;
  }

  async publish(handoff: DAGHandoff): Promise<void> {
    const clone = structuredClone(handoff);
    this.#published.push(clone);
    try {
      await this.onPublished(clone);
    } catch {
      // Subclass override errors must not corrupt channel state.
      // The envelope is already recorded; swallow the override failure
      // so publish() remains side-effect-safe for the dispatcher.
    }
  }

  /**
   * Called after each envelope is recorded. Default no-op. Subclass and
   * override to chain a downstream DAG: restore `handoff` state and call the
   * downstream dispatcher's `execute`. Receives the deep-cloned, stored
   * envelope (the same instance returned from `published`).
   *
   * Errors thrown from this hook are swallowed by `publish()`; the envelope
   * is already appended to `published` before the hook fires. Override errors
   * should be collected internally and surfaced through an observable property
   * rather than re-thrown.
   */
  protected async onPublished(_handoff: DAGHandoff): Promise<void> { /* override */ }
}
