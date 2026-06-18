import { WORKSET_PROGRESS_KEY } from '../entities/constants/ProgressKey.js';
import type { WorkSetProgress } from '../entities/workset/WorkSetProgress.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

/**
 * Persists and recalls the in-flight work-set blob in top-level state metadata.
 *
 * Written at the abort boundary (in `runNodes`) when the work set holds more
 * than one item or an item whose state is not the top-level state reference.
 * Read back at the resume boundary to rebuild `pending` before the schedule
 * loop starts.
 *
 * The blob is absent for size-1 canonical runs (one item whose state IS the
 * top-level state) because the existing cursor model covers that case exactly.
 * `WorkSetCheckpoint.write` is only called when that invariant does NOT hold.
 *
 * Mirrors `ScatterCheckpoint` exactly: validates at the read boundary so a
 * corrupt or migrated checkpoint surfaces here rather than deep in the
 * scheduler where the error would be harder to trace.
 */
export class WorkSetCheckpoint {
  private constructor() { /* static class */ }

  /**
   * Read and validate the stored work-set progress blob from state metadata.
   *
   * Returns `undefined` when no blob is present (size-1 canonical run).
   * Throws `ValidationError` when the stored value is present but does not
   * satisfy `WorkSetProgressSchema`.
   */
  static read(state: NodeStateInterface): WorkSetProgress | undefined {
    const raw = state.getMetadata<unknown>(WORKSET_PROGRESS_KEY);
    if (raw === undefined) return undefined;
    return Validator.workSetProgress.validate(raw);
  }

  /**
   * Persist the work-set progress blob to metadata. Called at the abort
   * boundary so the captured `state.snapshot()` includes the blob and
   * `Checkpoint.capture` picks it up automatically.
   */
  static write(state: NodeStateInterface, progress: WorkSetProgress): void {
    state.setMetadata(WORKSET_PROGRESS_KEY, progress);
  }

  /**
   * Remove the work-set progress blob from metadata. Called after the work
   * set is rebuilt on resume, and on clean completion, so a completed or
   * re-seeded run carries no stale progress.
   */
  static clear(state: NodeStateInterface): void {
    state.deleteMetadata(WORKSET_PROGRESS_KEY);
  }
}
