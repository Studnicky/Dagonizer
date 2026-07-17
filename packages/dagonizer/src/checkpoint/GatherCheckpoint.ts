import { GATHER_PROGRESS_KEY } from '../entities/constants/ProgressKey.js';
import type { GatherProgressType, GatherRecordProgressType } from '../entities/gather/GatherProgress.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import { Validator } from '../validation/Validator.js';

export class GatherCheckpoint {
  private constructor() { /* static class */ }

  static read(state: NodeStateInterface): GatherProgressType | undefined {
    const raw = state.getMetadata(GATHER_PROGRESS_KEY);
    if (raw === undefined) return undefined;
    return Validator.gatherProgress.validate(raw);
  }

  static write(state: NodeStateInterface, progress: GatherProgressType): void {
    state.setMetadata(GATHER_PROGRESS_KEY, progress);
  }

  static append(
    state: NodeStateInterface,
    gatherKey: string,
    records: readonly GatherRecordProgressType[],
  ): void {
    if (records.length === 0) return;
    const current = GatherCheckpoint.read(state) ?? { 'entries': {} };
    const existing = current.entries[gatherKey] ?? [];
    GatherCheckpoint.write(state, {
      'entries': {
        ...current.entries,
        [gatherKey]: [...existing, ...records],
      },
    });
  }

  static clear(state: NodeStateInterface): void {
    state.deleteMetadata(GATHER_PROGRESS_KEY);
  }
}
