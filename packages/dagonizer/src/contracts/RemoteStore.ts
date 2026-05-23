/**
 * RemoteStore — Store extended with distribution-specific operations.
 *
 * Plugins implement `RemoteStore` when their backing is over the network
 * (HTTP, gRPC, WebSocket) or replicated across processes. Local
 * in-memory and single-node-durable stores implement `Store` directly.
 *
 * The engine consumes a `RemoteStore` through the `Store` surface — the
 * extra methods are observability + coordination primitives the
 * dispatcher can use when distributed execution is wired in (post-v0.11).
 */

import type { Store } from './Store.js';

/** Identity + capability descriptor for a remote store. */
export interface RemoteStoreEndpoint {
  /** Stable identifier for the remote endpoint (URL, gRPC target, etc.). */
  readonly url: string;
  /**
   * Region/zone hint for placement decisions.
   * Default value at construction: `''` (no region constraint).
   */
  readonly region: string;
}

/**
 * Lease token returned by `acquireLease`. Opaque to consumers; the store
 * validates it on `releaseLease` and on writes when leasing is enforced.
 */
export interface RemoteStoreLease {
  /** Opaque token the store recognises on `releaseLease` / write checks. */
  readonly token:     string;
  /** Monotonic ms timestamp the lease expires at (exclusive). */
  readonly expiresAt: number;
  /** Subject the lease is scoped to (e.g. a key namespace or DAG run id). */
  readonly subject:   string;
}

/** RemoteStore — distributed shared-state contract. */
export interface RemoteStore extends Store {
  /** Endpoint descriptor; surfaces in observability / placement decisions. */
  readonly endpoint: RemoteStoreEndpoint;

  /**
   * Acquire a lease for `subject` with a maximum lifetime. The lease
   * grants exclusive write authority to whoever holds the token. The
   * store either returns a fresh lease or — when another holder is
   * active — waits up to `maxWaitMs` for the existing lease to expire
   * before throwing.
   *
   * Lease semantics are advisory unless the store enforces them on
   * writes; consumers must treat `RemoteStoreLease.token` as opaque.
   */
  acquireLease(subject: string, ttlMs: number, maxWaitMs: number): Promise<RemoteStoreLease>;

  /**
   * Release a previously-acquired lease. Idempotent: releasing an
   * already-expired lease is a no-op.
   */
  releaseLease(lease: RemoteStoreLease): Promise<void>;

  /**
   * Health probe. Returns `true` when the endpoint is reachable AND the
   * underlying backing responds within `timeoutMs`. Implementations
   * should NOT throw on transport failure — return `false` instead so
   * the dispatcher can route around an unhealthy store.
   */
  health(timeoutMs: number): Promise<boolean>;
}
