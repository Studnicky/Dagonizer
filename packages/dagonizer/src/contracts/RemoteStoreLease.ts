/**
 * RemoteStoreLease: lease token returned by `RemoteStore.acquireLease`.
 *
 * Opaque to consumers; the store validates it on `releaseLease` and on writes
 * when leasing is enforced.
 */

/**
 * Lease token returned by `acquireLease`. Opaque to consumers; the store
 * validates it on `releaseLease` and on writes when leasing is enforced.
 */
export interface RemoteStoreLease {
  /** Opaque token the store recognises on `releaseLease` / write checks. */
  token:     string;
  /** Monotonic ms timestamp the lease expires at (exclusive). */
  expiresAt: number;
  /** Subject the lease is scoped to (e.g. a key namespace or DAG run id). */
  subject:   string;
}
