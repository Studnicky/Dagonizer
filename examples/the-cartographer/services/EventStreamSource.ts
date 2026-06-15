/**
 * EventStreamSource: lazy AsyncIterable<SourcePayload> for the scatter source.
 *
 * Pulls from ShipmentEvents.rawScansGenerator — a sync generator that steps the
 * seeded LCG one journey at a time, yielding RawShipmentEvent records without
 * materialising the full array. Each record is encoded per-format via
 * Sources.buildPayloadFromScan and yielded as a SourcePayload, so peak memory is
 * O(batch) regardless of total count.
 *
 * The engine's scatter natively accepts AsyncIterable as the source value, so
 * assigning the result of EventStreamSource.stream to state.sources wires it
 * transparently with no DAG changes needed.
 *
 * Count override: `totalCount` overrides the sum of feedConfig entry counts.
 * When absent, the env var `CARTO_EVENT_COUNT` is checked, then the config sum
 * is used. Count is clamped to [1, 1_000_000].
 *
 * Determinism: ShipmentEvents.rawScansGenerator uses the same seeded LCG and
 * formatIdx as buildRawScans. Each scan at position k in the generator produces
 * the same RawShipmentEvent as buildRawScans(n)[k] (pre-sort). No Date.now or
 * Math.random in the data path.
 *
 * Format distribution: with a multi-entry FeedConfig, each yielded scan is
 * assigned a format by round-robin across the config entries (proportional to
 * each entry's count / configSum weight). When only one entry is present, all
 * scans use that entry's format and compression.
 */

import type { FeedConfig } from '../services.ts';
import { ShipmentEvents, Sources } from '../services.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';

const MIN_COUNT = 1;
const MAX_COUNT = 1_000_000;

/** Clamp n to [1, 1_000_000]. */
function clampCount(n: number): number {
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(n)));
}

/** Sum the event counts across all feed config entries. */
function configTotal(config: FeedConfig): number {
  let total = 0;
  for (const entry of config) total += entry.count;
  return total;
}

/** Resolve the effective total count: explicit → env → config sum. */
function resolveCount(config: FeedConfig, totalCount: number | undefined): number {
  if (totalCount !== undefined) return clampCount(totalCount);
  const envVal = process.env['CARTO_EVENT_COUNT'];
  if (envVal !== undefined && envVal.length > 0) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return clampCount(parsed);
  }
  return clampCount(configTotal(config));
}

/**
 * Build a per-scan format selector: given a FeedConfig and effective total count,
 * returns a function that maps a scan index (0-based) to the config entry whose
 * format/compression applies. Distribution is proportional — entry i receives
 * floor(entry.count / configSum * total) scans, with the remainder going to the
 * last non-zero entry.
 *
 * The selector is a flat array of indices into the config, one per output scan.
 * For large counts this array itself is O(effective) — so for the truly lazy path
 * we instead compute the format via cumulative thresholds (O(config entries), not
 * O(total)).
 */
function buildFormatThresholds(
  config: FeedConfig,
  effective: number,
  configSum: number,
): Array<{ format: 'csv' | 'json' | 'ndjson' | 'yaml'; compression: 'none' | 'gzip'; limit: number }> {
  const thresholds: Array<{ format: 'csv' | 'json' | 'ndjson' | 'yaml'; compression: 'none' | 'gzip'; limit: number }> = [];
  let allocated = 0;

  for (let i = 0; i < config.length; i++) {
    const entry = config[i]!;
    const isLast = i === config.length - 1;
    const count = isLast
      ? Math.max(0, effective - allocated)
      : configSum > 0
        ? Math.round((entry.count / configSum) * effective)
        : 0;
    allocated += count;
    if (count > 0) {
      thresholds.push({ format: entry.format, compression: entry.compression, limit: allocated });
    }
  }

  return thresholds;
}

// #region event-stream-source
export class EventStreamSource {
  private constructor() { /* static-only */ }

  /**
   * Return an AsyncIterable<SourcePayload> that yields payloads one record at a
   * time with O(1) peak memory relative to total count.
   *
   * Each scan from ShipmentEvents.rawScansGenerator is encoded via
   * Sources.buildPayloadFromScan (per-format, per-record) and yielded immediately.
   * Gzip for a single record is a tiny, bounded operation — no large string is
   * ever accumulated.
   *
   * Format assignment: scans are assigned to config entries in ascending threshold
   * order. The first `limit[0]` scans use entry[0]'s format/compression; the next
   * block uses entry[1]'s, and so on. This matches the proportional distribution
   * the eager path applies.
   *
   * @param config     Feed configuration driving format/compression/count.
   * @param totalCount Optional override for the total event count. When absent,
   *                   `CARTO_EVENT_COUNT` env var is checked, then the config sum.
   */
  static stream(config: FeedConfig, totalCount?: number): AsyncIterable<SourcePayload> {
    const effective = resolveCount(config, totalCount);
    const configSum = configTotal(config);
    const thresholds = buildFormatThresholds(config, effective, configSum);

    return {
      [Symbol.asyncIterator](): AsyncIterator<SourcePayload> {
        const generator = ShipmentEvents.rawScansGenerator(effective);
        let scanIndex = 0;

        return {
          async next(): Promise<IteratorResult<SourcePayload>> {
            const step = generator.next();
            if (step.done === true) {
              return { value: undefined as unknown as SourcePayload, done: true };
            }

            const scan = step.value;

            // Determine which config entry applies to this scan by threshold.
            let format: 'csv' | 'json' | 'ndjson' | 'yaml' = 'json';
            let compression: 'none' | 'gzip' = 'none';
            for (const threshold of thresholds) {
              if (scanIndex < threshold.limit) {
                format = threshold.format;
                compression = threshold.compression;
                break;
              }
            }

            const payload = await Sources.buildPayloadFromScan(scan, format, compression, scanIndex);
            scanIndex++;
            return { value: payload, done: false };
          },
        };
      },
    };
  }
}
// #endregion event-stream-source
