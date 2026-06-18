/**
 * store-remote/dags: demonstrates implementing the RemoteStore contract by
 * extending BaseStore. GrpcStore is a stub whose network methods log instead
 * of hitting a gRPC endpoint — shows every required method with the correct
 * shape.
 *
 * Pure module: no side effects, no dispatcher, no execute.
 */

// #region remote-store
import { BaseStore } from '@studnicky/dagonizer/store';
import type { StoreSnapshotEntry } from '@studnicky/dagonizer/store';
import type {
  RemoteStore,
  RemoteStoreEndpoint,
  RemoteStoreLease,
} from '@studnicky/dagonizer';
import type { JsonValue } from '@studnicky/dagonizer/entities';

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
    process.stdout.write(`[GrpcStore] connect -> ${this.endpoint.url}\n`);
  }

  override async disconnect(): Promise<void> {
    process.stdout.write(`[GrpcStore] disconnect -> ${this.endpoint.url}\n`);
  }

  async health(timeoutMs: number): Promise<boolean> {
    process.stdout.write(`[GrpcStore] health probe (timeout=${timeoutMs}ms)\n`);
    // Stub: always healthy in the example.
    return true;
  }

  async acquireLease(subject: string, ttlMs: number, maxWaitMs: number): Promise<RemoteStoreLease> {
    process.stdout.write(`[GrpcStore] acquireLease subject=${subject} ttl=${ttlMs}ms maxWait=${maxWaitMs}ms\n`);
    return {
      token:     `token:${subject}:${Date.now()}`,
      expiresAt: Date.now() + ttlMs,
      subject,
    };
  }

  async releaseLease(lease: RemoteStoreLease): Promise<void> {
    process.stdout.write(`[GrpcStore] releaseLease token=${lease.token}\n`);
  }

  // ── BaseStore abstract hooks ──────────────────────────────────────────────

  protected get snapshotType(): string    { return 'grpc-store'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | null> {
    const value = this.#data.get(key);
    return value === undefined ? null : (value as T);
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

