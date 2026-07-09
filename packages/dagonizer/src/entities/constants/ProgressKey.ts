/**
 * ProgressKey: reserved metadata keys the dispatcher uses to persist resume
 * bookkeeping on interruption.
 *
 *   scatter: per-placement scatter progress map (`StoredScatterProgress`)
 *   workSet: in-flight work-set blob (`WorkSetProgress`)
 *   gather: pending first-class gather barrier records (`GatherProgress`)
 *
 * Internal constant pair. NOT part of the public `constants.ts` barrel — the
 * public root barrel surfaces the two key values directly as
 * `SCATTER_PROGRESS_KEY` / `WORKSET_PROGRESS_KEY` / `GATHER_PROGRESS_KEY`. This
 * module is the canonical home so `runtime/`, `checkpoint/`, and the engine
 * import the keys inward.
 */

import type { FromSchema } from 'json-schema-to-ts';

export const ProgressKeySchema = {
  '$id': 'https://noocodec.dev/schemas/dagonizer/ProgressKey',
  '$schema': 'https://json-schema.org/draft/2020-12/schema',
  'type': 'string',
  'enum': ['__dagonizer_scatter_progress__', '__dagonizer_workset_progress__', '__dagonizer_gather_progress__'],
} as const;

/** Union type derived from `ProgressKeySchema` via `json-schema-to-ts`. */
export type ProgressKeyType = FromSchema<typeof ProgressKeySchema>;

/** Reserved progress metadata keys used by the dispatcher. */
export const ProgressKeys = {
  'SCATTER': '__dagonizer_scatter_progress__',
  'WORK_SET': '__dagonizer_workset_progress__',
  'GATHER': '__dagonizer_gather_progress__',
} as const satisfies Record<string, ProgressKeyType>;

/**
 * Reserved metadata key used by the scatter scheduler to persist per-placement
 * resume progress. **Consumer nodes must not write to this key.** It is
 * engine-internal and may be overwritten or cleared between batch boundaries.
 *
 * The stored value is a `StoredScatterProgress` map keyed by the scatter
 * placement's `name` so multiple scatter placements in one flow keep
 * independent entries.
 */
export const SCATTER_PROGRESS_KEY = ProgressKeys.SCATTER;

/**
 * Reserved metadata key used by the work-set scheduler to persist the in-flight
 * work set on interruption. **Consumer nodes must not write to this key.** It is
 * engine-internal and is cleared on resume after the work set is rebuilt and on
 * clean completion.
 *
 * The stored value is a `WorkSetProgress` blob serialised by
 * `WorkSetCheckpoint.write` and read back by `WorkSetCheckpoint.read`. Absent
 * for size-1 canonical runs (one item whose state IS the top-level state); the
 * cursor model handles that case exactly.
 */
export const WORKSET_PROGRESS_KEY = ProgressKeys.WORK_SET;

/**
 * Reserved metadata key used by first-class gather barriers to persist pending
 * producer records on interruption. Cleared after the barrier fires or after
 * clean top-level completion.
 */
export const GATHER_PROGRESS_KEY = ProgressKeys.GATHER;
