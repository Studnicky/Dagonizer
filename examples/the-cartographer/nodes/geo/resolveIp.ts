import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import type { IpGeolocator } from '../../contracts/IpGeolocator.ts';
import { OutcomeResolution } from './OutcomeResolution.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-ip-node
export class ResolveIpNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:resolve-ip';
  private readonly ipGeolocator: IpGeolocator;

  readonly 'name' = 'resolve-ip';
  readonly 'outputs' = ['resolved'] as const;

  constructor(ipGeolocator: IpGeolocator) {
    super();
    this.ipGeolocator = ipGeolocator;
  }

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<CartographerState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'resolved', CartographerState>> {
    for (const item of batch) {
      const raw = item.state.getMetadata('geo-signal');

      if (!GeoSignalDescriptorGuard.is(raw)) {
        item.state.candidate = GeoResolutionBuilder.from({ 'source': 'ip', 'weight': 0 });
        continue;
      }

      const outcome = await this.ipGeolocator.lookup(raw.ipAddress, context.signal);
      if (outcome.error !== null) {
        item.state.capturedErrors = [...item.state.capturedErrors, outcome.error];
      }
      item.state.candidate = OutcomeResolution.of(outcome, 'ip', raw.weight);
    }
    return RoutedBatch.create('resolved', batch);
  }
}
// #endregion resolve-ip-node
