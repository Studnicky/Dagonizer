import type { WritePointType } from '../contracts/WritePoint.js';
import type { DagConfiguration } from '../entities/configuration/DagConfiguration.js';
import { DAGError } from '../errors/index.js';

/** Registration-time write-point resolution and structural validation. */
export class WritePointPolicy {
  private constructor() { /* static-only */ }

  static resolve(
    owner: string,
    configuration: DagConfiguration.ResolvedType,
  ): ReadonlySet<WritePointType> {
    const resolved = new Set(configuration.durability.writePoints);
    if (resolved.has('FoldDeltaJournal') && !resolved.has('WatermarkCommit')) {
      throw new DAGError(
        `${owner}: writePoints cannot include 'FoldDeltaJournal' without 'WatermarkCommit'`,
        { 'code': 'CONFIGURATION_ERROR' },
      );
    }
    return resolved;
  }
}
