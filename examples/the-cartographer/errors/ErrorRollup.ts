/**
 * ErrorRollup: the bounded parent-side accumulator that the gather folds every
 * clone's `state.errors` into, so the run can PRINT the error distribution.
 *
 * Errors flow scatter → gather like every other datum: each enrichment clone
 * appends `GeoErrorRecordType`s to its own `state.errors`; the insights-fold
 * gather folds them here, grouped by `source`+`variant`, retaining a count and a
 * few sample messages per group. Memory is O(distinct source+variant groups) —
 * bounded regardless of event count, the same discipline as the region rollup.
 */

// #region error-rollup
import type { GeoErrorRecordType } from './GeoErrorRecord.ts';

/** One grouped error bucket: a `source`+`variant` pair with its count and samples. */
export interface ErrorGroupType {
  readonly source: string;
  readonly variant: string;
  count: number;
  /** A few representative messages (bounded by MAX_SAMPLES_PER_GROUP). */
  samples: string[];
  /** A representative offending input from this group. */
  sampleInput: string;
}

/** The full rollup: total count plus per-group buckets keyed by 'source variant'. */
export interface ErrorRollupType {
  total: number;
  groups: Map<string, ErrorGroupType>;
}

/** Distinct sample messages retained per group (bounded). */
const MAX_SAMPLES_PER_GROUP = 3;

export class ErrorRollup {
  /** A fresh, empty rollup (the gather resets to this per execution). */
  static empty(): ErrorRollupType {
    return { 'total': 0, 'groups': new Map() };
  }

  /** The bucket key for a record: source + variant (NUL-separated, collision-free). */
  static keyOf(record: GeoErrorRecordType): string {
    return `${record.source} ${record.variant}`;
  }

  /**
   * Fold one record into the rollup in place. Increments the total and the
   * group count; retains up to MAX_SAMPLES_PER_GROUP distinct messages.
   */
  static fold(rollup: ErrorRollupType, record: GeoErrorRecordType): void {
    rollup.total++;
    const key = ErrorRollup.keyOf(record);
    let group = rollup.groups.get(key);
    if (group === undefined) {
      group = {
        'source':      record.source,
        'variant':     record.variant,
        'count':       0,
        'samples':     [],
        'sampleInput': record.input,
      };
      rollup.groups.set(key, group);
    }
    group.count++;
    if (group.samples.length < MAX_SAMPLES_PER_GROUP && !group.samples.includes(record.message)) {
      group.samples.push(record.message);
    }
  }

  /** Groups sorted by descending count (dominant error sources first). */
  static ranked(rollup: ErrorRollupType): ErrorGroupType[] {
    return [...rollup.groups.values()].sort((a, b) => b.count - a.count);
  }

  /** Type predicate: narrows `unknown` to `ErrorRollupType` via structural runtime checks. */
  static is(v: unknown): v is ErrorRollupType {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    return 'total' in v && 'groups' in v;
  }
}
// #endregion error-rollup
