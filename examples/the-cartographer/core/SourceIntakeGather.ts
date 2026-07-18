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

  // `record.result` for this gather is `state.sourceFeed`: a live
  // `AsyncIterable<SourcePayload>` handle (see
  // `CartographerSourceIntake.mergeRecords`/`requireRecordFeed`), not
  // JSON-serialisable data. Compacting it into a durable `GatherRecordProgress`
  // (a JSON checkpoint payload) cannot survive a serialize/restore round trip —
  // there is no way to reconstruct a live async generator from its JSON
  // projection. `mode: 'full'` is the honest declaration: this gather cannot
  // participate in result-only durable replay, regardless of how narrow its
  // in-process clone-state read is.
  override transientResultSelection(): TransientNodeStateSelectionType {
    return { 'mode': 'full', 'domainPaths': [], 'metadataKeys': [] };
  }

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    accessor.set(state, 'source-payload', []);
  }

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    const records: GatherRecordType[] = [];
    for (const item of batch) records.push(item.state);
    const mergedPayload = CartographerSourceIntake.mergeRecords(records);
    accessor.set(state, 'source-payload', mergedPayload);
  }
}

GatherStrategies.register(new SourceIntakeGather());
// #endregion source-intake-gather
