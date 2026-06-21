/**
 * EventStreamSource: lazy AsyncIterable<SourcePayload> for the scatter source.
 *
 * `streamTyped` pulls from ShipmentEvents.typedScansGenerator — a sync generator
 * that interleaves typed scans across all config entries using a deterministic
 * fractional-accumulator scheduler (coin-sorter / weighted round-robin). Each
 * record is encoded per-format via Sources.buildPayloadFromScan and yielded as a
 * SourcePayload, so peak memory is O(numTypes) regardless of total count.
 *
 * The engine's scatter natively accepts AsyncIterable as the source value, so
 * assigning the result of EventStreamSource.streamTyped to state.sources wires it
 * transparently with no DAG changes needed.
 *
 * Format distribution: each EventTypeConfig entry's formatMix weights determine
 * the proportional threshold split for that entry's scan budget. Because scans are
 * now interleaved across types, a PER-TYPE local index (localIndices[configIndex])
 * drives each entry's threshold selector independently — format assignment is
 * stable regardless of emission order across the interleaved stream.
 *
 * Determinism: ShipmentEvents.typedScansGenerator uses independent seeded LCGs
 * per type sub-iterator. No Date.now or Math.random in the data path.
 *
 * Scale path: when totalCount exceeds the config's natural sum, streamTyped
 * drives typedScansGenerator in bounded cycles (at most CYCLE_CAP events per
 * cycle) so each cycle's interleaved generator holds at most O(CYCLE_CAP *
 * numTypes) scan candidates across all type buffers. Per-event-type proportions
 * from the original config are preserved across every cycle.
 */

import type { EventTypeConfig, TypedScan } from '../services.ts';
import { ShipmentEvents, Sources } from '../services.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';

const MIN_COUNT = 1;
const MAX_COUNT = 1_000_000;

/**
 * Maximum events per generator cycle in the scale path. Keeps buildRawScans
 * arrays bounded at O(CYCLE_CAP * 4) per entry regardless of effective total.
 */
const CYCLE_CAP = 2_000;

/** Clamp n to [1, 1_000_000]. */
function clampCount(n: number): number {
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(n)));
}

/** Sum total scans across all EventTypeConfig entries. */
function typedConfigTotal(config: EventTypeConfig): number {
  let total = 0;
  for (const entry of config) total += entry.count;
  return total;
}


/**
 * Scale the original config so the per-entry counts sum to exactly `target`,
 * preserving relative proportions from `originalSum`. Rounding drift is
 * corrected on the last entry with a non-zero scaled count. Returns a new
 * config array; formatMix values are shared by reference (read-only).
 */
function scaleConfig(config: EventTypeConfig, originalSum: number, target: number): EventTypeConfig {
  const scaled = config.map((entry) => ({
    'eventType': entry.eventType,
    'count': Math.round((entry.count / originalSum) * target),
    'formatMix': entry.formatMix,
  }));

  // Correct rounding drift so the scaled counts sum exactly to target.
  const scaledSum = scaled.reduce((s, e) => s + e.count, 0);
  const drift = target - scaledSum;
  if (drift !== 0) {
    for (let i = scaled.length - 1; i >= 0; i--) {
      if ((scaled[i]?.count ?? 0) > 0 || i === 0) {
        scaled[i] = { ...scaled[i]!, 'count': (scaled[i]?.count ?? 0) + drift };
        break;
      }
    }
  }

  return scaled;
}

// #region event-stream-source
export class EventStreamSource {
  private constructor() { /* static-only */ }

  /**
   * Build per-entry format thresholds from a FormatMix weight array.
   * Returns an array of cumulative limit thresholds mapping local scan indices to {format, compression}.
   */
  private static typedFormatThresholds(
    mix: EventTypeConfig[number]['formatMix'],
    count: number,
  ): Array<{ format: 'csv' | 'json' | 'ndjson' | 'yaml'; compression: 'none' | 'gzip'; limit: number }> {
    const totalWeight = mix.reduce((sum, m) => sum + m.weight, 0);
    const thresholds: Array<{ format: 'csv' | 'json' | 'ndjson' | 'yaml'; compression: 'none' | 'gzip'; limit: number }> = [];
    let allocated = 0;
    for (let mi = 0; mi < mix.length; mi++) {
      const m = mix[mi]!;
      const isLast = mi === mix.length - 1;
      const c = isLast
        ? Math.max(0, count - allocated)
        : totalWeight > 0
          ? Math.round((m.weight / totalWeight) * count)
          : 0;
      allocated += c;
      if (c > 0) {
        thresholds.push({ format: m.format, compression: m.compression, limit: allocated });
      }
    }
    return thresholds;
  }

  /**
   * Return an AsyncIterable<SourcePayload> for a typed feed. Yields payloads
   * lazily from ShipmentEvents.typedScansGenerator with O(1) peak memory.
   *
   * Format assignment: each entry's formatMix weights determine the proportional
   * threshold split for that entry's scan budget. Local index within each entry
   * drives the per-entry threshold selector.
   *
   * Scale path: when totalCount exceeds the config sum, the generator runs in
   * bounded cycles (at most CYCLE_CAP events per cycle) with a proportionally
   * scaled config per cycle. This keeps buildRawScans arrays bounded at
   * O(CYCLE_CAP) per cycle regardless of effective total count.
   *
   * Backward compatibility: when totalCount is undefined or does not exceed the
   * config sum, the original single-pass path is used unchanged so existing
   * consumers receive byte-identical output.
   *
   * @param config     Typed feed configuration.
   * @param totalCount Optional override for total event count. When absent, the
   *                   sum of entry counts is used. Clamped to [1, 1_000_000].
   */
  static streamTyped(config: EventTypeConfig, totalCount?: number): AsyncIterable<SourcePayload> {
    const originalSum = typedConfigTotal(config);
    const effective = totalCount !== undefined ? clampCount(totalCount) : clampCount(originalSum);

    // Backward-compatible single-pass path: effective fits within the config's
    // natural sum — one generator pass produces exactly `effective` payloads.
    // With the interleaved generator, scans arrive in mixed-type order, so each
    // type's local format index is tracked by config entry index (looked up from
    // the scan's eventType) rather than by sequential stream position.
    if (effective <= originalSum) {
      const entryThresholds = config.map((entry) =>
        EventStreamSource.typedFormatThresholds(entry.formatMix, entry.count),
      );

      // Map eventType → config index for O(1) per-scan format-index lookup.
      // When config has multiple entries with the same eventType the FIRST index
      // wins (same tie-break as the generator's slot ordering).
      const eventTypeToConfigIdx = new Map<string, number>();
      for (let i = 0; i < config.length; i++) {
        const et = config[i]!.eventType;
        if (!eventTypeToConfigIdx.has(et)) eventTypeToConfigIdx.set(et, i);
      }

      return {
        [Symbol.asyncIterator](): AsyncIterator<SourcePayload> {
          const generator = ShipmentEvents.typedScansGenerator(config);
          let globalIndex = 0;
          // Per-type local index — advances independently for each config entry
          // so format thresholds apply within each type's budget, not globally.
          const localIndices = new Array<number>(config.length).fill(0);

          return {
            async next(): Promise<IteratorResult<SourcePayload, undefined>> {
              if (globalIndex >= effective) {
                return { value: undefined, done: true };
              }

              const step = generator.next();
              if (step.done === true) {
                return { value: undefined, done: true };
              }

              const scan = step.value;

              // Resolve config entry by the scan's eventType (interleaved order).
              const configIdx = eventTypeToConfigIdx.get(scan.eventType) ?? 0;
              const currentEntry = config[configIdx]!;
              const localIdx = localIndices[configIdx] ?? 0;
              const thresholds = entryThresholds[configIdx] ?? [];

              let format: 'csv' | 'json' | 'ndjson' | 'yaml' = currentEntry.formatMix[0]?.format ?? 'json';
              let compression: 'none' | 'gzip' = currentEntry.formatMix[0]?.compression ?? 'none';
              for (const threshold of thresholds) {
                if (localIdx < threshold.limit) {
                  format = threshold.format;
                  compression = threshold.compression;
                  break;
                }
              }

              const payload = await Sources.buildPayloadFromScan(scan, format, compression, globalIndex, currentEntry.eventType);
              const sourceId = `${currentEntry.eventType}-${format}-${compression}-${globalIndex}`;

              localIndices[configIdx] = localIdx + 1;
              globalIndex++;

              return {
                value: { ...payload, 'sourceId': sourceId, 'eventType': currentEntry.eventType },
                done: false,
              };
            },
          };
        },
      };
    }

    // Scale path: effective > originalSum.
    //
    // Run typedScansGenerator in bounded cycles of at most CYCLE_CAP events
    // each. Each cycle receives a proportionally scaled config whose per-entry
    // counts sum to min(CYCLE_CAP, remaining), keeping each cycle's interleaved
    // generator memory bounded at O(numTypes) scan candidates. A monotonically
    // increasing globalIndex guarantees unique sourceIds across all cycles.
    // Per-type local indices reset at cycle boundaries (each cycle is an
    // independent scaled config, so threshold offsets restart from 0 within it).
    return {
      [Symbol.asyncIterator](): AsyncIterator<SourcePayload> {
        let globalIndex = 0;
        let remaining = effective;

        // Current cycle state — null signals no cycle has started yet.
        let cycleGenerator: Generator<TypedScan> | null = null;
        let cycleConfig: EventTypeConfig = [];
        let cycleEntryThresholds: Array<Array<{ format: 'csv' | 'json' | 'ndjson' | 'yaml'; compression: 'none' | 'gzip'; limit: number }>> = [];
        let cycleEventTypeToIdx: Map<string, number> = new Map();
        let cycleLocalIndices: number[] = [];
        let cycleTotal = 0;
        let cycleYielded = 0;

        function startNextCycle(): void {
          const batchSize = Math.min(CYCLE_CAP, remaining);
          cycleConfig = scaleConfig(config, originalSum, batchSize);
          cycleTotal = cycleConfig.reduce((s, e) => s + e.count, 0);
          cycleEntryThresholds = cycleConfig.map((entry) =>
            EventStreamSource.typedFormatThresholds(entry.formatMix, entry.count),
          );
          // Build eventType → cycleConfig index map for per-type local index lookup.
          cycleEventTypeToIdx = new Map();
          for (let i = 0; i < cycleConfig.length; i++) {
            const et = cycleConfig[i]!.eventType;
            if (!cycleEventTypeToIdx.has(et)) cycleEventTypeToIdx.set(et, i);
          }
          cycleGenerator = ShipmentEvents.typedScansGenerator(cycleConfig);
          cycleLocalIndices = new Array<number>(cycleConfig.length).fill(0);
          cycleYielded = 0;
          remaining -= batchSize;
        }

        return {
          async next(): Promise<IteratorResult<SourcePayload, undefined>> {
            // Advance to the next cycle when the current one is exhausted.
            while (cycleGenerator === null || cycleYielded >= cycleTotal) {
              if (remaining <= 0) {
                return { value: undefined, done: true };
              }
              startNextCycle();
            }

            const step = cycleGenerator.next();
            // Guard against an unexpectedly exhausted generator (mis-scaled config).
            if (step.done === true) {
              return { value: undefined, done: true };
            }

            const scan = step.value;

            // Resolve config entry by the scan's eventType (interleaved order).
            const cycleConfigIdx = cycleEventTypeToIdx.get(scan.eventType) ?? 0;
            const currentEntry = cycleConfig[cycleConfigIdx]!;
            const localIdx = cycleLocalIndices[cycleConfigIdx] ?? 0;
            const thresholds = cycleEntryThresholds[cycleConfigIdx] ?? [];

            let format: 'csv' | 'json' | 'ndjson' | 'yaml' = currentEntry.formatMix[0]?.format ?? 'json';
            let compression: 'none' | 'gzip' = currentEntry.formatMix[0]?.compression ?? 'none';
            for (const threshold of thresholds) {
              if (localIdx < threshold.limit) {
                format = threshold.format;
                compression = threshold.compression;
                break;
              }
            }

            const payload = await Sources.buildPayloadFromScan(scan, format, compression, globalIndex, currentEntry.eventType);
            const sourceId = `${currentEntry.eventType}-${format}-${compression}-${globalIndex}`;

            cycleLocalIndices[cycleConfigIdx] = localIdx + 1;
            cycleYielded++;
            globalIndex++;

            return {
              value: { ...payload, 'sourceId': sourceId, 'eventType': currentEntry.eventType },
              done: false,
            };
          },
        };
      },
    };
  }
}
// #endregion event-stream-source
