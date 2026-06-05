import { SCATTER_PROGRESS_KEY } from '../Dagonizer.js';
import type { ScatterAckedResult, ScatterInboxItem, ScatterProgress, StoredScatterProgress } from '../Dagonizer.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class ScatterCheckpoint {
  private constructor() { /* static class */ }

  /**
   * Persist the current scatter checkpoint (inbox + acked results) to
   * metadata. Called after each item ack so the checkpoint always reflects
   * the latest durable state.
   */
  static write(
    state: NodeStateInterface,
    placementName: string,
    inbox: readonly ScatterInboxItem[],
    ackedResults: readonly ScatterAckedResult[],
  ): void {
    const stored = state.getMetadata<StoredScatterProgress>(SCATTER_PROGRESS_KEY) ?? {};
    const next: Record<string, ScatterProgress> = { ...stored };
    next[placementName] = { placementName, inbox, ackedResults };
    state.setMetadata(SCATTER_PROGRESS_KEY, next);
  }

  /**
   * Remove this placement's progress entry. Called after the scatter loop
   * drains so a subsequent re-run starts clean. When the resulting map is
   * empty the reserved metadata key is removed entirely so a clean snapshot
   * omits it.
   */
  static clear(state: NodeStateInterface, placementName: string): void {
    const stored = state.getMetadata<StoredScatterProgress>(SCATTER_PROGRESS_KEY);
    if (stored === undefined) return;
    if (!(placementName in stored)) return;
    const next: Record<string, ScatterProgress> = { ...stored };
    delete next[placementName];
    if (Object.keys(next).length === 0) {
      state.deleteMetadata(SCATTER_PROGRESS_KEY);
    } else {
      state.setMetadata(SCATTER_PROGRESS_KEY, next);
    }
  }
}
