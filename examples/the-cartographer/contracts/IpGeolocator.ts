/**
 * IpGeolocator: the IP-modality TRANSPORT adapter contract.
 *
 * A thin transport: given a public IP address, return ONE modality's location
 * candidate. The `ip-geolocate` DAG node calls this; fusion happens in `fuse-geo`.
 * Swappable: `LiveIpGeolocator` (real freeipapi.com HTTPS) online,
 * `RecordedIpGeolocator` (committed fixture replay) for the deterministic smoke.
 *
 * Injected via constructor DI into `IpGeolocateNode`.
 */

// #region ip-geolocator-contract
import type { GeoLookupOutcomeType } from '../errors/GeoLookupOutcome.ts';

export interface IpGeolocator {
  /**
   * Geolocate a public IP to a single IP-modality outcome. The outcome's
   * `candidate` resolves to `{ resolved: false, … }` (never throws) when the
   * backend has no answer (no IP, fixture miss); the outcome's `error` is set
   * ONLY when a real exception was caught (HTTP / JSON failure) — surfaced to
   * the node as DATA, never swallowed.
   */
  lookup(ipAddress: string, signal: AbortSignal): Promise<GeoLookupOutcomeType>;
}
// #endregion ip-geolocator-contract
