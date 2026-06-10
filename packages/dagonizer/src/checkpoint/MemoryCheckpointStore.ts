/**
 * MemoryCheckpointStore: in-process `CheckpointStore`.
 *
 * Stores entries in a `Map<string, string>` on the instance. Useful for
 * tests, examples, and ephemeral demo flows. Not for production: the
 * map vanishes when the process exits.
 */

import type { CheckpointStore } from '../contracts/CheckpointStore.js';

export class MemoryCheckpointStore implements CheckpointStore {
  readonly #entries = new Map<string, string>();

  async save(key: string, json: string, _signal?: AbortSignal): Promise<void> {
    this.#entries.set(key, json);
  }

  async load(key: string, _signal?: AbortSignal): Promise<string | null> {
    return this.#entries.get(key) ?? null;
  }

  async delete(key: string, _signal?: AbortSignal): Promise<void> {
    this.#entries.delete(key);
  }

  /** Number of entries currently held. Test-only convenience. */
  get size(): number {
    return this.#entries.size;
  }
}
