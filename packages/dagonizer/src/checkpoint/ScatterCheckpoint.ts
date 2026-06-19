import { SCATTER_PROGRESS_KEY } from '../entities/constants/ProgressKey.js';
import type { ScatterAckedResultType, ScatterInboxItemType, ScatterProgressType, StoredScatterProgressType } from '../entities/scatter/ScatterProgress.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

export class ScatterCheckpoint {
  private constructor() { /* static class */ }

  /**
   * Read and validate the stored scatter progress map from state metadata.
   *
   * Validates the raw metadata value with `Validator.storedScatterProgress`
   * at the read boundary so a corrupt or migrated checkpoint fails here —
   * close to the ingest point — rather than deep in the scatter loop where
   * the error would be harder to trace. Returns `undefined` when no
   * checkpoint entry exists for this placement.
   *
   * Throws `ValidationError` when the stored value is present but does not
   * satisfy `StoredScatterProgressSchema`.
   */
  static read(
    state: NodeStateInterface,
    placementName: string,
  ): ScatterProgressType | undefined {
    const raw = state.getMetadata<unknown>(SCATTER_PROGRESS_KEY);
    if (raw === undefined) return undefined;
    // Validate at the read boundary so corrupt/migrated checkpoints surface
    // here rather than causing silent type mismatches in the scatter loop.
    const stored = Validator.storedScatterProgress.validate(raw);
    return stored[placementName];
  }

  /**
   * Persist a retained-mode scatter checkpoint (full per-item acked results)
   * for non-compactable gather strategies.
   */
  static writeRetained(
    state: NodeStateInterface,
    placementName: string,
    inbox: readonly ScatterInboxItemType[],
    ackedResults: readonly ScatterAckedResultType[],
  ): void {
    const raw = state.getMetadata<StoredScatterProgressType>(SCATTER_PROGRESS_KEY) ?? {};
    const next: Record<string, ScatterProgressType> = { ...raw };
    next[placementName] = { 'mode': 'retained', placementName, 'inbox': [...inbox], 'ackedResults': [...ackedResults] };
    state.setMetadata(SCATTER_PROGRESS_KEY, next);
  }

  /**
   * Persist a bounded-mode scatter checkpoint (watermark + ahead-acked window
   * + outcome tally) for compactable gather strategies.
   */
  static writeBounded(
    state: NodeStateInterface,
    placementName: string,
    inbox: readonly ScatterInboxItemType[],
    watermark: number,
    aheadAcked: readonly { index: number; output: string }[],
    outcomeTally: Readonly<Record<string, number>>,
  ): void {
    const raw = state.getMetadata<StoredScatterProgressType>(SCATTER_PROGRESS_KEY) ?? {};
    const next: Record<string, ScatterProgressType> = { ...raw };
    next[placementName] = { 'mode': 'bounded', placementName, 'inbox': [...inbox], watermark, 'aheadAcked': [...aheadAcked], 'outcomeTally': { ...outcomeTally } };
    state.setMetadata(SCATTER_PROGRESS_KEY, next);
  }

  /**
   * Remove this placement's progress entry. Called after the scatter loop
   * drains so a subsequent re-run starts clean. When the resulting map is
   * empty the reserved metadata key is removed entirely so a clean snapshot
   * omits it.
   */
  static clear(state: NodeStateInterface, placementName: string): void {
    const stored = state.getMetadata<StoredScatterProgressType>(SCATTER_PROGRESS_KEY);
    if (stored === undefined) return;
    if (!(placementName in stored)) return;
    const next: Record<string, ScatterProgressType> = { ...stored };
    delete next[placementName];
    if (Object.keys(next).length === 0) {
      state.deleteMetadata(SCATTER_PROGRESS_KEY);
    } else {
      state.setMetadata(SCATTER_PROGRESS_KEY, next);
    }
  }
}
