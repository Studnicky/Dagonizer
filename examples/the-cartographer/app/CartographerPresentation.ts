/**
 * CartographerPresentation: the narrow browser-facing view of CartographerState.
 *
 * CartographerRunner.vue does not read execution state directly for its
 * presentation needs. It reads this projection instead, which selects only
 * the fold-accumulator fields that are ALSO safe to expose to a live
 * streaming UI: exact progress, the bounded sample feed, the insights and
 * journey aggregates, and the bounded error rollup. Every field here is
 * written by a gather strategy (mostly InsightsFoldGather) and stays
 * bounded regardless of event count.
 *
 * See CartographerState's top-of-file doc comment for the full
 * execution-scratch / fold-accumulator / durable-checkpoint / presentation
 * classification this projection draws from. Config writes (e.g.
 * `state.eventCount`) are not presentation reads and are not part of this
 * contract — the caller still writes those fields directly on the state.
 *
 * `of()` takes a defensive shallow copy of each field. The underlying
 * fields are mutated in place by the gather while a run is in progress
 * (the sample ring buffer, the insights/journeys Maps, the error-rollup
 * Map), so a presentation snapshot needs its own container even though the
 * leaf values are not deep-cloned — the same shallow-copy idiom
 * CartographerRunner.vue already applied inline before this projection
 * existed (`[...state.sampleRecords]`, `new Map(state.insights)`).
 */

import type { CartographerState, JourneyInsights, RegionInsights } from '../CartographerState.ts';
import type { EnrichedShipment } from '../entities/EnrichedShipment.ts';
import type { ErrorRollupType } from '../errors/ErrorRollup.ts';

// #region cartographer-presentation
/** The bounded browser-facing read surface projected from CartographerState. */
export interface CartographerPresentationType {
  readonly processedCountExact: number;
  readonly sampleRecords: readonly EnrichedShipment[];
  readonly sampleRecordsCursor: number;
  readonly sampleRecordsWrapped: boolean;
  readonly insights: ReadonlyMap<string, RegionInsights>;
  readonly journeys: ReadonlyMap<string, JourneyInsights>;
  readonly errorRollup: ErrorRollupType;
}

export class CartographerPresentation {
  /** Project the browser-facing read surface out of a live or finished CartographerState. */
  static of(state: CartographerState): CartographerPresentationType {
    return {
      'processedCountExact':  state.processedCountExact,
      'sampleRecords':        [...state.sampleRecords],
      'sampleRecordsCursor':  state.sampleRecordsCursor,
      'sampleRecordsWrapped': state.sampleRecordsWrapped,
      'insights':             new Map(state.insights),
      'journeys':             new Map(state.journeys),
      'errorRollup':          { 'total': state.errorRollup.total, 'groups': new Map(state.errorRollup.groups) },
    };
  }
}
// #endregion cartographer-presentation
