/**
 * InMemoryChannel: local default and loopback `ChannelInterface` implementation.
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

import type { ChannelInterface } from '../contracts/ChannelInterface.js';
import type { DAGHandoff } from '../entities/handoff/DAGHandoff.js';

/**
 * Constructor options for `InMemoryChannel`. Currently carries no fields; the
 * type exists as the extension point for future channel configuration and to
 * keep the constructor's options-object shape canonical.
 */
export type InMemoryChannelOptions = Record<string, never>;

export class InMemoryChannel implements ChannelInterface {
  private readonly _published: DAGHandoff[];

  constructor(_options: InMemoryChannelOptions = {}) {
    this._published = [];
  }

  /** All published envelopes in publish order (deep-cloned on entry). */
  get published(): readonly DAGHandoff[] {
    return this._published;
  }

  async publish(handoff: DAGHandoff): Promise<void> {
    const clone = structuredClone(handoff) as DAGHandoff;
    this._published.push(clone);
    await this.onPublished(clone);
  }

  /**
   * Called after each envelope is recorded. Default no-op. Subclass and
   * override to chain a downstream DAG: restore `handoff` state and call the
   * downstream dispatcher's `execute`. Receives the deep-cloned, stored
   * envelope (the same instance returned from `published`).
   */
  protected async onPublished(_handoff: DAGHandoff): Promise<void> { /* override */ }
}
