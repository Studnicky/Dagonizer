/**
 * RemoteStoreEndpoint: identity + capability descriptor for a remote store.
 *
 * Surfaces in observability and placement decisions. A `RemoteStore` carries
 * one as its `endpoint` field.
 */

/** Identity + capability descriptor for a remote store. */
export interface RemoteStoreEndpoint {
  /** Stable identifier for the remote endpoint (URL, gRPC target, etc.). */
  url: string;
  /**
   * Region/zone hint for placement decisions.
   * Default value at construction: `''` (no region constraint).
   */
  region: string;
}
