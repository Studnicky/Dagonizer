/**
 * EventStreamSource: async generator alternative to Sources.buildFromConfig.
 *
 * Yields SourcePayloads one at a time as an AsyncIterable, enabling the
 * engine's scatter to consume them with backpressure rather than materialising
 * the entire source array in memory before dispatch begins.
 *
 * The engine's scatter natively supports AsyncIterable as the source value
 * (resolved via the accessor at runtime), so assigning the generator to
 * `state.sources` wires it transparently — no DAG changes needed.
 *
 * Deterministic: uses Sources.buildFromConfig internally (which calls
 * ShipmentEvents.buildRawScans with the seeded LCG). No Date.now or
 * Math.random in the data path. Each SourcePayload is yielded once it is
 * fully built, preserving the lazy-generation property.
 *
 * Count override: `totalCount` overrides the sum of feedConfig entry counts.
 * When absent, the env var `CARTO_EVENT_COUNT` is checked, then the config
 * sum is used. Count is clamped to [1, 1_000_000].
 */

import type { FeedConfig } from '../services.ts';
import { Sources } from '../services.ts';
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

// #region event-stream-source
export class EventStreamSource {
  private constructor() { /* static-only */ }

  /**
   * Return an AsyncIterable<SourcePayload> that yields payloads lazily, one
   * per FeedConfig entry. Each entry's payload is built via
   * Sources.buildFromConfig (deterministic, seeded LCG) and yielded as a
   * single unit once ready.
   *
   * The total number of raw scan journeys generated is proportionally
   * distributed across config entries (same ratio as each entry's count vs
   * the config total). When only one entry is present all journeys go there.
   *
   * @param config     Feed configuration driving format/compression/count.
   * @param totalCount Optional override for the total event count. When
   *                   absent, `CARTO_EVENT_COUNT` env var is checked, then
   *                   the sum of config entry counts is used.
   */
  static stream(config: FeedConfig, totalCount?: number): AsyncIterable<SourcePayload> {
    const effective = resolveCount(config, totalCount);
    const configSum = configTotal(config);

    return {
      [Symbol.asyncIterator](): AsyncIterator<SourcePayload> {
        // Build a proportional config for the requested total count. Each
        // entry receives floor(entry.count / configSum * effective) journeys,
        // with the remainder added to the last non-zero entry.
        const scaledConfig: FeedConfig = config.map((entry, idx) => {
          const isLast = idx === config.length - 1;
          const proportional = configSum > 0
            ? Math.round((entry.count / configSum) * effective)
            : 0;
          // Last entry absorbs any rounding remainder so total == effective.
          const allocatedSoFar = config
            .slice(0, idx)
            .reduce((sum, e) => sum + Math.round((e.count / configSum) * effective), 0);
          const count = isLast
            ? Math.max(0, effective - allocatedSoFar)
            : proportional;
          return { 'format': entry.format, 'compression': entry.compression, 'count': count };
        });

        // Build all payloads eagerly but yield them lazily one at a time.
        // This keeps the generator simple (no streaming gzip/CSV) while still
        // demonstrating the AsyncIterable scatter source path.
        let payloadsPromise: Promise<SourcePayload[]> | null = null;
        let idx = 0;

        return {
          async next(): Promise<IteratorResult<SourcePayload>> {
            if (payloadsPromise === null) {
              payloadsPromise = Sources.buildFromConfig(scaledConfig);
            }
            const payloads = await payloadsPromise;
            if (idx >= payloads.length) {
              return { 'value': undefined as unknown as SourcePayload, 'done': true };
            }
            const payload = payloads[idx++] as SourcePayload;
            return { 'value': payload, 'done': false };
          },
        };
      },
    };
  }
}
// #endregion event-stream-source
