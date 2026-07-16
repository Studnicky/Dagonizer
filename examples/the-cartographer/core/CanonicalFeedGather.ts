/**
 * CanonicalFeedGather: open gather for producer feed DAG outputs.
 *
 * Each source-specific feed DAG emits its validated CanonicalEventVariant array.
 * This gather flattens those producer outputs into one shared
 * state.canonicalEvents collection consumed by the common enrichment scatter.
 */

import type { GatherRecordType } from '@studnicky/dagonizer/contracts';
import { GatherStrategies, GatherStrategy } from '@studnicky/dagonizer/core';
import type { GatherConfigType, NodeStateInterface } from '@studnicky/dagonizer/types';
import type { StateAccessorInterface } from '@studnicky/dagonizer/contracts';

import { CanonicalEventVariantBuilder } from '../entities/CanonicalEvent.ts';
import type { CanonicalEventVariant } from '../entities/CanonicalEvent.ts';

// #region canonical-feed-gather
export class CanonicalFeedGather extends GatherStrategy {
  readonly name = 'canonical-feed';
  readonly '@id' = 'urn:noocodec:node:canonical-feed';

  override initial(
    _config: GatherConfigType,
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    accessor.set(state, 'canonicalEvents', []);
  }

  override reduce(
    _config: GatherConfigType,
    batch: Parameters<GatherStrategy['reduce']>[1],
    state: NodeStateInterface,
    accessor: StateAccessorInterface,
  ): void {
    for (const item of batch) {
      const record: GatherRecordType = item.state;
      const value = record.result ?? accessor.get(record.cloneState, 'canonicalEvents');
      for (const event of CanonicalFeedGather.eventsFrom(value)) {
        accessor.append(state, 'canonicalEvents', event);
      }
    }
  }

  private static eventsFrom(value: unknown): CanonicalEventVariant[] {
    if (!Array.isArray(value)) return [];
    return value.filter(CanonicalEventVariantBuilder.is);
  }
}

GatherStrategies.register(new CanonicalFeedGather());
// #endregion canonical-feed-gather
