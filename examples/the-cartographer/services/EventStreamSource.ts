/**
 * EventStreamSource: lazy AsyncIterable<SourcePayload> for the scatter source.
 *
 * `streamTyped` pulls from ShipmentEvents.typedScansGenerator — a sync generator
 * that steps the seeded LCG one journey at a time, yielding typed scans without
 * materialising the full array. Each record is encoded per-format via
 * Sources.buildPayloadFromScan and yielded as a SourcePayload, so peak memory is
 * O(1) regardless of total count.
 *
 * The engine's scatter natively accepts AsyncIterable as the source value, so
 * assigning the result of EventStreamSource.streamTyped to state.sources wires it
 * transparently with no DAG changes needed.
 *
 * Format distribution: each EventTypeConfig entry's formatMix weights determine
 * the proportional threshold split for that entry's scan budget. Local index
 * within each entry drives the per-entry threshold selector.
 *
 * Determinism: ShipmentEvents.typedScansGenerator uses the same seeded LCG as
 * buildTypedFeed. No Date.now or Math.random in the data path.
 */

import type { EventTypeConfig } from '../services.ts';
import { ShipmentEvents, Sources } from '../services.ts';
import type { SourcePayload } from '../entities/SourcePayload.ts';

const MIN_COUNT = 1;
const MAX_COUNT = 1_000_000;

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
 * Build per-entry format thresholds from a FormatMix weight array.
 * Returns an array of cumulative limit thresholds mapping local scan indices to {format, compression}.
 */
function buildTypedFormatThresholds(
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

// #region event-stream-source
export class EventStreamSource {
  private constructor() { /* static-only */ }

  /**
   * Return an AsyncIterable<SourcePayload> for a typed feed. Yields payloads
   * lazily from ShipmentEvents.typedScansGenerator with O(1) peak memory.
   *
   * Format assignment: each entry's formatMix weights determine the proportional
   * threshold split for that entry's scan budget. Local index within each entry
   * drives the per-entry threshold selector.
   *
   * @param config     Typed feed configuration.
   * @param totalCount Optional override for total event count. When absent, the
   *                   sum of entry counts is used. Clamped to [1, 1_000_000].
   */
  static streamTyped(config: EventTypeConfig, totalCount?: number): AsyncIterable<SourcePayload> {
    const rawTotal = typedConfigTotal(config);
    const effective = totalCount !== undefined ? clampCount(totalCount) : clampCount(rawTotal);

    // Build per-entry thresholds once before iteration.
    const entryThresholds = config.map((entry) =>
      buildTypedFormatThresholds(entry.formatMix, entry.count),
    );

    return {
      [Symbol.asyncIterator](): AsyncIterator<SourcePayload> {
        const generator = ShipmentEvents.typedScansGenerator(config);
        let globalIndex = 0;
        // Track local index per config entry by config position.
        const localIndices = new Array<number>(config.length).fill(0);
        let configPos = 0;
        let countInCurrentEntry = 0;

        return {
          async next(): Promise<IteratorResult<SourcePayload>> {
            if (globalIndex >= effective) {
              return { value: undefined as unknown as SourcePayload, done: true };
            }

            const step = generator.next();
            if (step.done === true) {
              return { value: undefined as unknown as SourcePayload, done: true };
            }

            const scan = step.value;

            // Advance configPos to match the current entry based on cumulative counts.
            while (configPos < config.length - 1) {
              const entry = config[configPos]!;
              if (countInCurrentEntry >= entry.count) {
                configPos++;
                countInCurrentEntry = 0;
              } else {
                break;
              }
            }

            const currentEntry = config[configPos]!;
            const localIdx = localIndices[configPos] ?? 0;
            const thresholds = entryThresholds[configPos] ?? [];

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

            localIndices[configPos] = localIdx + 1;
            countInCurrentEntry++;
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
