/**
 * StreamCursor: resume-ordinal accessor for scatter placements.
 *
 * Reads the scatter checkpoint from state metadata and returns the number of
 * items already durably pulled by the scatter loop (`nextIndex`). A producer
 * uses this count to skip already-consumed emissions on resume, reconstructing
 * its deterministic sequence from the top and fast-forwarding past the prefix
 * the scatter has already durably acknowledged.
 *
 * The cursor is the scatter's PULL count, not the producer's push count: items
 * that were buffered-but-not-yet-pulled at crash time are re-emitted (nothing
 * buffered-and-lost-on-crash is skipped). Returns 0 on a fresh run (no
 * checkpoint exists for this placement).
 */

import { ScatterCheckpoint } from '../checkpoint/ScatterCheckpoint.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options controlling which gather accumulator family `resumeAfter` reads. */
export type StreamCursorOptionsType = {
  'compactable': boolean;
};

/** Module-level defaults. `compactable: true` selects bounded gather. */
const STREAM_CURSOR_DEFAULTS: StreamCursorOptionsType = {
  'compactable': true,
};

// ---------------------------------------------------------------------------
// StreamCursor
// ---------------------------------------------------------------------------

export class StreamCursor {
  private constructor() { /* static noun */ }

  /**
   * Resume ordinal for a scatter placement: the count of items already durably
   * pulled (`nextIndex`). 0 on a fresh run (no checkpoint). A producer resumes
   * by skipping its first `resumeAfter` emissions; buffered-but-unpulled items
   * are re-emitted (the cursor is the scatter's PULL count, not the producer's
   * push count, so nothing buffered-and-lost-on-crash is skipped). `compactable`
   * selects the gather accumulator family — true for bounded (default), false
   * for a retained gather.
   */
  static resumeAfter(
    state: NodeStateInterface,
    scatterName: string,
    options?: Partial<StreamCursorOptionsType>,
  ): number {
    const { compactable } = { ...STREAM_CURSOR_DEFAULTS, ...options };
    const stored = ScatterCheckpoint.read(state, scatterName);
    return ScatterCheckpoint.restoreRunState(stored, compactable).nextIndex;
  }
}
