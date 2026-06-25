/**
 * custom-checkpoint-store/dags: pure module — two real CheckpointStore /
 * Snapshottable implementations with in-process backings.
 *
 * No side effects, no dispatcher, no execute. Imported by
 * examples/custom-checkpoint-store.ts (the executable entry point).
 *
 * Demonstrates:
 *   1. MapCheckpointStore — the three-method CheckpointStoreInterface
 *      (save / load / delete) backed by a real Map. The exact same shape
 *      a Postgres/Redis/S3 store fills in; only the backing changes.
 *   2. FactLog — a non-KV SnapshottableInterface (snapshot / restore) that
 *      rides along in a checkpoint without implementing the full Store
 *      surface. Here the backing is an in-process append-only string list.
 */

import type {
  CheckpointStoreInterface,
  SnapshottableInterface,
  StoreSnapshotEntryType,
  StoreSnapshotType,
} from '@studnicky/dagonizer/contracts';

// ---------------------------------------------------------------------------
// MapCheckpointStore: the three-method contract over a real Map.
// ---------------------------------------------------------------------------

// #region custom-store
export class MapCheckpointStore implements CheckpointStoreInterface {
  readonly #entries = new Map<string, string>();

  async save(key: string, json: string): Promise<void> {
    this.#entries.set(key, json);
  }

  async load(key: string): Promise<string | null> {
    return this.#entries.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  /** Test/inspection helper — not part of the contract. */
  get size(): number {
    return this.#entries.size;
  }
}
// #endregion custom-store

// ---------------------------------------------------------------------------
// FactLog: a non-KV Snapshottable. snapshot()/restore() only — no get/set.
// ---------------------------------------------------------------------------

// #region snapshottable
export class FactLog implements SnapshottableInterface {
  readonly #facts: string[] = [];

  add(fact: string): void {
    this.#facts.push(fact);
  }

  get facts(): readonly string[] {
    return this.#facts;
  }

  async snapshot(): Promise<StoreSnapshotType> {
    return {
      version: 1,
      type: 'fact-log',
      entries: this.#facts.map((fact, i) => ({ key: String(i), value: fact })),
    };
  }

  async restore(snapshot: StoreSnapshotType): Promise<void> {
    if (snapshot.type !== 'fact-log') {
      throw new Error(`Incompatible snapshot type: ${snapshot.type}`);
    }
    this.#facts.length = 0;
    for (const entry of snapshot.entries) {
      this.#facts.push(String(entry.value));
    }
  }

  async *snapshotStream(): AsyncIterable<StoreSnapshotEntryType> {
    for (let i = 0; i < this.#facts.length; i++) {
      const fact = this.#facts[i];
      if (fact !== undefined) yield { key: String(i), value: fact };
    }
  }

  async restoreStream(entries: AsyncIterable<StoreSnapshotEntryType>): Promise<void> {
    this.#facts.length = 0;
    for await (const entry of entries) {
      this.#facts.push(String(entry.value));
    }
  }
}
// #endregion snapshottable
