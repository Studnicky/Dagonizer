/**
 * SourceIntakeGather: source-payload compatibility gather.
 *
 * The current runnable Cartographer topology uses producer feed DAGs plus
 * CanonicalFeedGather. This strategy remains registered for source-payload
 * compatibility examples that can emit either a merged `state['source-payload']`
 * stream (stream-source strategy) or `state.sources` (legacy consumers).
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
