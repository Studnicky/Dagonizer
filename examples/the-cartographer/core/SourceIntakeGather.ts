/**
 * SourceIntakeGather: top-level source-payload gather.
 *
 * The runnable Cartographer topology gathers producer feed results into one
 * merged source-payload collection for the process-stream scatter.
 */

import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import { GatherStrategies, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherConfigType, NodeStateInterface } from '@studnicky/dagonizer/types';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';
import type { TransientNodeStateSelectionType } from '@studnicky/dagonizer';

import { CartographerSourceIntake } from '../nodes/sourceIntake.ts';

// #region source-intake-gather
export class SourceIntakeGather extends GatherStrategy {
  readonly name = 'source-intake';
  readonly '@id' = 'urn:noocodec:node:source-intake';

  override transientResultSelection(): TransientNodeStateSelectionType {
    return {
      'mode': 'selection',
      'domainPaths': ['sourceFeed'],
      'metadataKeys': [],
    };
  }

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    accessor.set(state, 'source-payload', []);
    accessor.set(state, 'sources', []);
  }

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const records: GatherRecordType[] = [];
    for (const item of batch) records.push(item.state);
    const mergedPayload = CartographerSourceIntake.mergeRecords(records, state);
    accessor.set(state, 'source-payload', mergedPayload);
    accessor.set(state, 'sources', mergedPayload);
  }
}

GatherStrategies.register(new SourceIntakeGather());
// #endregion source-intake-gather
