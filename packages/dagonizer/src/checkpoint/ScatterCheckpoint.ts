import { SCATTER_PROGRESS_KEY } from '../entities/constants/ProgressKey.js';
import type { ScatterAckedResultType, ScatterInboxItemType, ScatterProgressType, StoredScatterProgressType } from '../entities/scatter/ScatterProgress.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

/**
 * Restored scatter run accumulators materialised from a stored checkpoint.
 *
 * One bundle holds every accumulator the scatter loop reads or writes. The
 * compactable path drives `watermarkRef`/`aheadAcked`/`outcomeTally`; the
 * retained path drives `ackedResults`/`ackedByIndex`/`itemOutputs`. Both share
 * `inbox`, `seenIndices`, and `nextIndex`. All are initialised in a fixed order
 * regardless of branch so the bundle's shape is consistent across constructions.
 */
export type ScatterRunStateType = {
  readonly inbox: ScatterInboxItemType[];
  readonly ackedResults: ScatterAckedResultType[];
  readonly ackedByIndex: Map<number, ScatterAckedResultType>;
  readonly itemOutputs: Map<number, string>;
  readonly watermarkRef: { value: number };
  readonly aheadAcked: Map<number, string>;
  readonly outcomeTally: Map<string, number>;
  readonly seenIndices: Set<number>;
  nextIndex: number;
}

export class ScatterCheckpoint {
  private constructor() { /* static class */ }

  /**
   * Fold an acked item into the bounded-mode accounting: record its output in
   * `outcomeTally`, place its index in the ahead window, then drain consecutive
   * indices into the watermark so the watermark always equals the highest
   * contiguous completed prefix. Bounded-mode bookkeeping is checkpoint state,
   * so it lives here beside the read/write/restore surface.
   */
  static advanceWatermark(
    watermarkRef: { value: number },
    aheadAcked: Map<number, string>,
    outcomeTally: Map<string, number>,
    index: number,
    output: string,
  ): void {
    // Always fold output into tally for every acked item.
    outcomeTally.set(output, (outcomeTally.get(output) ?? 0) + 1);
    // Place acked index into the ahead window (handles any index >= watermark).
    aheadAcked.set(index, output);
    // Greedily advance watermark while contiguous indices exist.
    while (aheadAcked.has(watermarkRef.value)) {
      aheadAcked.delete(watermarkRef.value);
      watermarkRef.value++;
    }
  }

  /**
   * Materialise the scatter run accumulators from a stored checkpoint.
   *
   * Seeds the inbox from the stored entry, then reconstructs the mode-specific
   * accumulators: bounded restores watermark/ahead-window/tally directly (and
   * translates a defensive retained-on-disk checkpoint into bounded in-memory
   * form via {@link advanceWatermark}); retained restores the full acked-result
   * set. `seenIndices` and `nextIndex` are derived so resume reprocesses inbox
   * gaps and assigns fresh indices past every prior item.
   *
   * `compactable` selects the accumulator family; both families are always
   * allocated so the bundle's shape is branch-independent (V8 stability).
   */
  static restoreRunState(
    storedProgress: ScatterProgressType | undefined,
    compactable: boolean,
  ): ScatterRunStateType {
    const inbox: ScatterInboxItemType[] = [...(storedProgress?.inbox ?? [])];
    const ackedResults: ScatterAckedResultType[] = [];
    const ackedByIndex = new Map<number, ScatterAckedResultType>();
    const itemOutputs = new Map<number, string>();
    const watermarkRef: { value: number } = { 'value': 0 };
    const aheadAcked = new Map<number, string>();
    const outcomeTally = new Map<string, number>();
    const seenIndices = new Set<number>();
    let nextIndex = 0;

    if (compactable) {
      if (storedProgress?.mode === 'bounded') {
        // Restore bounded checkpoint.
        watermarkRef.value = storedProgress.watermark;
        for (const entry of storedProgress.aheadAcked) aheadAcked.set(entry.index, entry.output);
        for (const [output, count] of Object.entries(storedProgress.outcomeTally)) outcomeTally.set(output, count);
        // seenIndices = {0..watermark-1} ∪ aheadAcked.keys() ∪ inbox.indices
        for (let i = 0; i < watermarkRef.value; i++) seenIndices.add(i);
        for (const k of aheadAcked.keys()) seenIndices.add(k);
        for (const entry of inbox) seenIndices.add(entry.index);
        // nextIndex = max(watermark, max(aheadAcked.keys)+1, max(inbox.index)+1, 0)
        nextIndex = watermarkRef.value;
        if (aheadAcked.size > 0) {
          const maxAhead = Math.max(...aheadAcked.keys());
          if (maxAhead + 1 > nextIndex) nextIndex = maxAhead + 1;
        }
        if (inbox.length > 0) {
          const maxInbox = Math.max(...inbox.map((e) => e.index));
          if (maxInbox + 1 > nextIndex) nextIndex = maxInbox + 1;
        }
      } else if (storedProgress?.mode === 'retained') {
        // Defensive: translate retained checkpoint into bounded in-memory form.
        for (const r of storedProgress.ackedResults) {
          ScatterCheckpoint.advanceWatermark(watermarkRef, aheadAcked, outcomeTally, r.index, r.output);
        }
        for (let i = 0; i < watermarkRef.value; i++) seenIndices.add(i);
        for (const k of aheadAcked.keys()) seenIndices.add(k);
        for (const entry of inbox) seenIndices.add(entry.index);
        nextIndex = watermarkRef.value;
        if (aheadAcked.size > 0) {
          const maxAhead = Math.max(...aheadAcked.keys());
          if (maxAhead + 1 > nextIndex) nextIndex = maxAhead + 1;
        }
        if (inbox.length > 0) {
          const maxInbox = Math.max(...inbox.map((e) => e.index));
          if (maxInbox + 1 > nextIndex) nextIndex = maxInbox + 1;
        }
      }
    } else {
      // Non-compactable (retained mode): restore full ackedResults.
      if (storedProgress?.mode === 'retained') {
        for (const r of storedProgress.ackedResults) {
          ackedResults.push(r);
          ackedByIndex.set(r.index, r);
          itemOutputs.set(r.index, r.output);
          seenIndices.add(r.index);
        }
      }
      for (const entry of inbox) seenIndices.add(entry.index);
      for (const item of [...inbox, ...ackedResults]) {
        if (item.index >= nextIndex) nextIndex = item.index + 1;
      }
    }

    return { inbox, ackedResults, ackedByIndex, itemOutputs, watermarkRef, aheadAcked, outcomeTally, seenIndices, nextIndex };
  }

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
