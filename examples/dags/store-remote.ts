/**
 * store-remote/dags: demonstrates implementing the RemoteStore contract by
 * extending BaseStore. GrpcStore is a stub whose network methods log instead
 * of hitting a gRPC endpoint — shows every required method with the correct
 * shape.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 */

// #region remote-store
import { BaseStore } from '@noocodex/dagonizer/store';
import type { StoreSnapshot, StoreSnapshotEntry } from '@noocodex/dagonizer/store';
import type {
  RemoteStore,
  RemoteStoreEndpoint,
  RemoteStoreLease,
} from '@noocodex/dagonizer';
import type { JsonValue } from '@noocodex/dagonizer/entities';

/**
 * GrpcStore: stub RemoteStore backed by an in-memory map.
 * Network methods (connect, disconnect, health, acquireLease, releaseLease)
 * log instead of making real gRPC calls — illustrating the contract surface.
 */
export class GrpcStore extends BaseStore implements RemoteStore {
  readonly endpoint: RemoteStoreEndpoint;
  readonly #data = new Map<string, JsonValue>();

  constructor(url: string, region: string = '') {
    super({ namespace: 'archivist' });
    this.endpoint = { url, region };
  }

  // ── RemoteStore distributed contract ─────────────────────────────────────

  override async connect(): Promise<void> {
    console.log(`[GrpcStore] connect -> ${this.endpoint.url}`);
  }

  override async disconnect(): Promise<void> {
    console.log(`[GrpcStore] disconnect -> ${this.endpoint.url}`);
  }

  async health(timeoutMs: number): Promise<boolean> {
    console.log(`[GrpcStore] health probe (timeout=${timeoutMs}ms)`);
    // Stub: always healthy in the example.
    return true;
  }

  async acquireLease(subject: string, ttlMs: number, maxWaitMs: number): Promise<RemoteStoreLease> {
    console.log(`[GrpcStore] acquireLease subject=${subject} ttl=${ttlMs}ms maxWait=${maxWaitMs}ms`);
    return {
      token:     `token:${subject}:${Date.now()}`,
      expiresAt: Date.now() + ttlMs,
      subject,
    };
  }

  async releaseLease(lease: RemoteStoreLease): Promise<void> {
    console.log(`[GrpcStore] releaseLease token=${lease.token}`);
  }

  // ── BaseStore abstract hooks ──────────────────────────────────────────────

  protected get snapshotType(): string    { return 'grpc-store'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | undefined> {
    return this.#data.get(key) as T | undefined;
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
    this.#data.set(key, value);
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.#data.has(key);
  }

  protected async performDelete(key: string): Promise<boolean> {
    return this.#data.delete(key);
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    return [...this.#data.entries()].map(([key, value]) => ({ key, value }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
    this.#data.clear();
    for (const { key, value } of entries) {
      this.#data.set(key, value);
    }
  }

  // Override update for atomic RMW — in-memory direct access is safe.
  override async update<T extends JsonValue>(key: string, fn: (current: T | undefined) => T): Promise<T> {
    const qualified = this.qualifyKey(key);
    const current   = this.#data.get(qualified) as T | undefined;
    const next      = fn(current);
    this.#data.set(qualified, next);
    return next;
  }
}
// #endregion remote-store

// Compile-time check: GrpcStore satisfies both contracts.
const _check: RemoteStore = new GrpcStore('grpc://catalogue.archivist.svc:50051', 'us-east-1');
void _check;
// Suppress unused import (StoreSnapshot is referenced through the implement chain).
type _SS = StoreSnapshot;
void 0 as unknown as _SS;
