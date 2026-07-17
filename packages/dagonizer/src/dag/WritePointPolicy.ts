import type { WritePointType } from '../contracts/WritePoint.js';
import { DEFAULT_WRITE_POINTS } from '../contracts/WritePoint.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { DAGError } from '../errors/index.js';

/** Registration-time write-point resolution and structural validation. */
export class WritePointPolicy {
  private constructor() { /* static-only */ }

  static resolveDag(dag: DAGType): ReadonlySet<WritePointType> {
    return WritePointPolicy.resolveSet(`DAG '${dag.name}'`, dag.writePoints);
  }

  static resolvePlacement(
    dag: DAGType,
    placement: DAGNodeType,
    inherited: ReadonlySet<WritePointType>,
  ): ReadonlySet<WritePointType> {
    if (Placement.isScatter(placement) && placement.writePoints !== undefined) {
      return WritePointPolicy.resolveSet(
        `ScatterNode '${placement.name}' in DAG '${dag.name}'`,
        placement.writePoints,
      );
    }
    return inherited;
  }

  private static resolveSet(
    owner: string,
    values: readonly WritePointType[] | undefined,
  ): ReadonlySet<WritePointType> {
    const resolved = new Set(values ?? DEFAULT_WRITE_POINTS);
    if (resolved.has('FoldDeltaJournal') && !resolved.has('WatermarkCommit')) {
      throw new DAGError(
        `${owner}: writePoints cannot include 'FoldDeltaJournal' without 'WatermarkCommit'`,
        { 'code': 'CONFIGURATION_ERROR' },
      );
    }
    return resolved;
  }
}
