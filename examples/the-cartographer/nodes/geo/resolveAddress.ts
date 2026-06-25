import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import type { AddressGeocoder } from '../../contracts/AddressGeocoder.ts';
import { OutcomeResolution } from './OutcomeResolution.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-address-node
export class ResolveAddressNode extends ScalarNode<CartographerState, 'resolved'> {
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

  protected override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    const raw = state.getMetadata('geo-signal');

    if (!GeoSignalDescriptorGuard.is(raw)) {
      state.candidate = GeoResolutionBuilder.from({ 'source': 'address', 'weight': 0 });
      return NodeOutputBuilder.of('resolved');
    }

    const outcome = await this.addressGeocoder.geocode(raw.address, context.signal);
    if (outcome.error !== null) {
      state.capturedErrors = [...state.capturedErrors, outcome.error];
    }
    state.candidate = OutcomeResolution.of(outcome, 'address', raw.weight);
    return NodeOutputBuilder.of('resolved');
  }
}
// #endregion resolve-address-node
