import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import type { AddressGeocoder } from '../../contracts/AddressGeocoder.ts';
import { OutcomeResolution } from './OutcomeResolution.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-address-node
export class ResolveAddressNode extends MonadicNode<CartographerState, 'resolved'> {
  private readonly addressGeocoder: AddressGeocoder;

  readonly 'name' = 'resolve-address';
  readonly 'outputs' = ['resolved'] as const;

  constructor(addressGeocoder: AddressGeocoder) {
    super();
    this.addressGeocoder = addressGeocoder;
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
        item.state.candidate = GeoResolutionBuilder.from({ 'source': 'address', 'weight': 0 });
        continue;
      }

      const outcome = await this.addressGeocoder.geocode(raw.address, context.signal);
      if (outcome.error !== null) {
        item.state.capturedErrors = [...item.state.capturedErrors, outcome.error];
      }
      item.state.candidate = OutcomeResolution.of(outcome, 'address', raw.weight);
    }
    return RoutedBatch.create('resolved', batch);
  }
}
// #endregion resolve-address-node
