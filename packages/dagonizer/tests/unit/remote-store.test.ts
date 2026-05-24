/**
 * remote-store.test.ts
 *
 * Verifies that:
 * 1. A concrete class can implement `RemoteStore` by extending `BaseStore` —
 *    the contract is fully implementable without gaps.
 * 2. The new `StoreErrorClassification` reasons discriminate correctly via
 *    the `reason` discriminant field.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { RemoteStore, RemoteStoreEndpoint, RemoteStoreLease } from '../../src/contracts/RemoteStore.js';
import type { StoreSnapshotEntry } from '../../src/contracts/Store.js';
import type { JsonValue } from '../../src/entities/json.js';
import { BaseStore, type BaseStoreOptions } from '../../src/store/BaseStore.js';
import { StoreError, type StoreErrorClassification } from '../../src/store/StoreError.js';

// ── MockRemoteStore ─────────────────────────────────────────────────────────
//
// Minimal no-op implementation. Purpose: prove the RemoteStore contract is
// fully implementable; no production behavior required.

class MockRemoteStore extends BaseStore implements RemoteStore {
  readonly endpoint: RemoteStoreEndpoint;

  readonly #backing: Map<string, JsonValue>;

  constructor(endpoint: RemoteStoreEndpoint, options: BaseStoreOptions = {}) {
    super(options);
    this.endpoint = endpoint;
    this.#backing = new Map();
  }

  // ── BaseStore abstract hooks ────────────────────────────────────────────

  protected get snapshotType(): string    { return 'mock-remote-store-v1'; }
  protected get snapshotVersion(): number { return 1; }

  protected async performGet<T extends JsonValue>(key: string): Promise<T | undefined> {
    return this.#backing.get(key) as T | undefined;
  }

  protected async performSet<T extends JsonValue>(key: string, value: T): Promise<void> {
    this.#backing.set(key, value);
  }

  protected async performHas(key: string): Promise<boolean> {
    return this.#backing.has(key);
  }

  protected async performDelete(key: string): Promise<boolean> {
    return this.#backing.delete(key);
  }

  protected async performSnapshotEntries(): Promise<readonly StoreSnapshotEntry[]> {
    return [...this.#backing.entries()].map(([key, value]) => ({ key, value }));
  }

  protected async performRestoreEntries(entries: readonly StoreSnapshotEntry[]): Promise<void> {
    this.#backing.clear();
    for (const { key, value } of entries) {
      this.#backing.set(key, value);
    }
  }

  // Atomic override — Map access is synchronous, no interleaving possible.
  override async update<T extends JsonValue>(
    key: string,
    fn: (current: T | undefined) => T,
  ): Promise<T> {
    const qualified = this.qualifyKey(key);
    const next      = fn(this.#backing.get(qualified) as T | undefined);
    this.#backing.set(qualified, next);
    return next;
  }

  // ── RemoteStore-specific methods ────────────────────────────────────────

  async acquireLease(subject: string, ttlMs: number, _maxWaitMs: number): Promise<RemoteStoreLease> {
    return {
      'token':     `mock-token-${subject}`,
      'expiresAt': Date.now() + ttlMs,
      'subject':   subject,
    };
  }

  async releaseLease(_lease: RemoteStoreLease): Promise<void> {
    // no-op — mock never holds state for leases
  }

  async health(_timeoutMs: number): Promise<boolean> {
    return true;
  }
}

// ── Contract shape tests ─────────────────────────────────────────────────────

void describe('RemoteStore contract', () => {
  void it('MockRemoteStore is assignable to RemoteStore (contract is fully implementable)', () => {
    const endpoint: RemoteStoreEndpoint = { 'url': 'http://localhost:6379', 'region': '' };
    const store: RemoteStore = new MockRemoteStore(endpoint);
    assert.ok(store instanceof MockRemoteStore);
    assert.equal(store.endpoint.url, 'http://localhost:6379');
    assert.equal(store.endpoint.region, '');
  });

  void it('endpoint with region hint round-trips correctly', () => {
    const endpoint: RemoteStoreEndpoint = { 'url': 'grpc://store.us-east-1.internal:50051', 'region': 'us-east-1' };
    const store = new MockRemoteStore(endpoint);
    assert.equal(store.endpoint.region, 'us-east-1');
  });

  void it('acquireLease returns a well-formed RemoteStoreLease', async () => {
    const store = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    const ttl   = 5_000;
    const before = Date.now();
    const lease: RemoteStoreLease = await store.acquireLease('run-abc', ttl, 1_000);

    assert.equal(lease.subject, 'run-abc');
    assert.ok(typeof lease.token === 'string' && lease.token.length > 0);
    assert.ok(lease.expiresAt >= before + ttl);
  });

  void it('releaseLease resolves without throwing', async () => {
    const store = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    const lease: RemoteStoreLease = {
      'token':     'tok-xyz',
      'expiresAt': Date.now() + 1_000,
      'subject':   'run-xyz',
    };
    await assert.doesNotReject(() => store.releaseLease(lease));
  });

  void it('health() returns true when endpoint is up', async () => {
    const store = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    const ok = await store.health(200);
    assert.equal(ok, true);
  });

  void it('Store surface (get/set/has/delete) works through RemoteStore', async () => {
    const store: RemoteStore = new MockRemoteStore({ 'url': 'http://localhost:6379', 'region': '' });
    await store.set<string>('greeting', 'hello');
    assert.equal(await store.get('greeting'), 'hello');
    assert.equal(await store.has('greeting'), true);
    const deleted = await store.delete('greeting');
    assert.equal(deleted, true);
    assert.equal(await store.has('greeting'), false);
  });
});

// ── StoreError remote-specific discriminants ─────────────────────────────────

void describe('StoreError — remote-specific classification reasons', () => {
  void it('LEASE_DENIED classifies and discriminates correctly', () => {
    const classification: StoreErrorClassification = {
      'reason':  'LEASE_DENIED',
      'subject': 'run-abc',
      'holder':  'worker-7',
    };
    const err = new StoreError('lease denied: run-abc held by worker-7', classification);

    assert.ok(err instanceof StoreError);
    assert.equal(err.classification.reason, 'LEASE_DENIED');

    if (err.classification.reason === 'LEASE_DENIED') {
      assert.equal(err.classification.subject, 'run-abc');
      assert.equal(err.classification.holder, 'worker-7');
    } else {
      assert.fail('expected LEASE_DENIED reason');
    }
  });

  void it('LEASE_EXPIRED classifies and discriminates correctly', () => {
    const classification: StoreErrorClassification = {
      'reason':  'LEASE_EXPIRED',
      'subject': 'run-abc',
      'token':   'tok-stale-xyz',
    };
    const err = new StoreError('lease expired: tok-stale-xyz', classification);

    assert.ok(err instanceof StoreError);
    assert.equal(err.classification.reason, 'LEASE_EXPIRED');

    if (err.classification.reason === 'LEASE_EXPIRED') {
      assert.equal(err.classification.subject, 'run-abc');
      assert.equal(err.classification.token, 'tok-stale-xyz');
    } else {
      assert.fail('expected LEASE_EXPIRED reason');
    }
  });

  void it('UNREACHABLE classifies and discriminates correctly', () => {
    const cause = new Error('ECONNREFUSED');
    const classification: StoreErrorClassification = {
      'reason':   'UNREACHABLE',
      'endpoint': 'http://localhost:6379',
      'cause':    cause,
    };
    const err = new StoreError('store unreachable: http://localhost:6379', classification);

    assert.ok(err instanceof StoreError);
    assert.equal(err.classification.reason, 'UNREACHABLE');

    if (err.classification.reason === 'UNREACHABLE') {
      assert.equal(err.classification.endpoint, 'http://localhost:6379');
      assert.equal(err.classification.cause, cause);
    } else {
      assert.fail('expected UNREACHABLE reason');
    }
  });

  void it('existing BACKING_ERROR reason is unaffected by the new union members', () => {
    const cause = new Error('disk full');
    const classification: StoreErrorClassification = {
      'reason': 'BACKING_ERROR',
      'cause':  cause,
    };
    const err = new StoreError('backing error', classification);

    assert.equal(err.classification.reason, 'BACKING_ERROR');
    if (err.classification.reason === 'BACKING_ERROR') {
      assert.equal(err.classification.cause, cause);
    } else {
      assert.fail('expected BACKING_ERROR reason');
    }
  });
});
