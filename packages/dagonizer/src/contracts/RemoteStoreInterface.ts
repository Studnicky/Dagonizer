/**
 * RemoteStoreInterface: StoreInterface extended with distribution-specific operations.
 *
 * Plugins implement `RemoteStoreInterface` when their backing is over the network
 * (HTTP, gRPC, WebSocket) or replicated across processes. Local
 * in-memory and single-node-durable stores implement `StoreInterface` directly.
 *
 * The engine consumes a `RemoteStoreInterface` through the `StoreInterface` surface; the
 * extra methods are observability + coordination primitives the
 * dispatcher uses when distributed execution is active.
 */

import type { RemoteStoreEndpointType } from './RemoteStoreEndpoint.js';
import type { RemoteStoreLeaseType } from './RemoteStoreLease.js';
import type { StoreInterface } from './StoreInterface.js';

/** RemoteStoreInterface: distributed shared-state contract. */
export interface RemoteStoreInterface extends StoreInterface {
  /** Endpoint descriptor; surfaces in observability / placement decisions. */
  readonly endpoint: RemoteStoreEndpointType;

  /**
   * Acquire a lease for `subject` with a maximum lifetime. The lease
   * grants exclusive write authority to whoever holds the token. The
   * store either returns a fresh lease, or, when another holder is
   * active, waits up to `maxWaitMs` for the existing lease to expire
   * before throwing.
   *
   * Lease semantics are advisory unless the store enforces them on
   * writes; consumers must treat `RemoteStoreLeaseType.token` as opaque.
   */
  acquireLease(subject: string, ttlMs: number, maxWaitMs: number): Promise<RemoteStoreLeaseType>;

  /**
   * Release a previously-acquired lease. Idempotent: releasing an
   * already-expired lease is a no-op.
   */
  releaseLease(lease: RemoteStoreLeaseType): Promise<void>;

  /**
   * Health probe. Returns `true` when the endpoint is reachable AND the
   * underlying backing responds within `timeoutMs`. Implementations
   * should NOT throw on transport failure; return `false` instead so
   * the dispatcher can route around an unhealthy store.
   */
  health(timeoutMs: number): Promise<boolean>;
}
