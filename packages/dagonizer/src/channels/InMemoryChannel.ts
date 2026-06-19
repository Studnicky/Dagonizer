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
import type { DAGHandoffType } from '../entities/handoff/DAGHandoff.js';

/**
 * Constructor options for `InMemoryChannel`. Currently carries no fields; the
 * type exists as the extension point for future channel configuration and to
 * keep the constructor's options-object shape canonical.
 */
export type InMemoryChannelOptionsType = Record<string, never>;

export class InMemoryChannel implements HandoffChannelInterface {
  #published: DAGHandoffType[];
  readonly #publishErrors: Error[];

  constructor(_options: InMemoryChannelOptionsType = {}) {
    this.#published = [];
    this.#publishErrors = [];
  }

  /** All published envelopes in publish order (deep-cloned on entry). */
  get published(): readonly DAGHandoffType[] {
    return this.#published;
  }

  /**
   * Errors thrown by `onPublished` overrides, in the order they were caught.
   * Each entry corresponds to a `publish()` call whose `onPublished` hook threw.
   * The channel records these rather than swallowing them silently so callers
   * can assert on hook errors in tests. The happy path (no throws) leaves this
   * array empty.
   */
  get publishErrors(): readonly Error[] {
    return this.#publishErrors;
  }

  async publish(handoff: DAGHandoffType): Promise<void> {
    const clone = structuredClone(handoff);
    this.#published.push(clone);
    try {
      await this.onPublished(clone);
    } catch (err) {
      // Subclass override errors must not corrupt channel state.
      // The envelope is already recorded; collect the error rather than
      // swallowing it silently so callers can observe hook failures.
      this.#publishErrors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Called after each envelope is recorded. Default no-op. Subclass and
   * override to chain a downstream DAG: restore `handoff` state and call the
   * downstream dispatcher's `execute`. Receives the deep-cloned, stored
   * envelope (the same instance returned from `published`).
   *
   * Errors thrown from this hook are collected in `publishErrors` rather than
   * re-thrown; the envelope is already appended to `published` before the hook
   * fires. Override errors surface through the `publishErrors` getter instead
   * of propagating to the publisher.
   */
  protected async onPublished(_handoff: DAGHandoffType): Promise<void> { /* override */ }
}
