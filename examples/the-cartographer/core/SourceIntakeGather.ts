/**
 * SourceIntakeGather: source-payload compatibility gather.
 *
 * The current runnable Cartographer topology uses producer feed DAGs plus
 * CanonicalFeedGather. This strategy remains registered for source-payload
 * stream examples that need a merged `state.sources` stream.
 */

import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import { GatherStrategies, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherConfigType, NodeStateInterface } from '@studnicky/dagonizer/types';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';

import { CartographerSourceIntake } from '../nodes/sourceIntake.ts';

// #region source-intake-gather
export class SourceIntakeGather extends GatherStrategy {
  readonly name = 'source-intake';
  readonly '@id' = 'urn:noocodec:node:source-intake';

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
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
    accessor.set(state, 'sources', CartographerSourceIntake.mergeRecords(records, state));
  }
}

GatherStrategies.register(new SourceIntakeGather());
// #endregion source-intake-gather
