/**
 * GeoLookupOutcome: the result a geo transport returns — a GeoCandidate PLUS an
 * optional captured-error marker.
 *
 * The `GeoCandidate` schema is wire-shape-locked (`additionalProperties: false`)
 * and cannot carry a runtime-only error marker, so the transport returns this
 * narrowing wrapper instead: the candidate keeps graceful degradation (an
 * unresolved candidate still flows so the pipeline continues), while `error`
 * surfaces a real caught exception to the node as DATA. `error` is set ONLY when
 * a genuine exception was caught — graceful open-water, no-IP, and
 * fixture-miss outcomes resolve with `error: null`.
 *
 * The `reverse-geocode` / `ip-geolocate` nodes read `error` and append it to
 * `state.errors`; the candidate is stored on `state.gpsCandidate` /
 * `state.ipCandidate` exactly as before.
 */

// #region geo-lookup-outcome
import type { GeoCandidate } from '../entities/GeoCandidate.ts';
import type { GeoErrorRecordType } from './GeoErrorRecord.ts';

export interface GeoLookupOutcomeType {
  readonly candidate: GeoCandidate;
  /** A captured exception, or `null` when the lookup degraded gracefully. */
  readonly error: GeoErrorRecordType | null;
}

export class GeoLookupOutcome {
  /** A clean outcome: the candidate resolved (or degraded gracefully), no error. */
  static resolved(candidate: GeoCandidate): GeoLookupOutcomeType {
    return { 'candidate': candidate, 'error': null };
  }

  /**
   * A failed outcome: the candidate degraded gracefully (still flows) AND a real
   * exception was caught — carried as `error` so the node records it.
   */
  static failed(candidate: GeoCandidate, error: GeoErrorRecordType): GeoLookupOutcomeType {
    return { 'candidate': candidate, 'error': error };
  }
}
// #endregion geo-lookup-outcome
