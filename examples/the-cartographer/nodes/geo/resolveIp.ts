import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import type { IpGeolocator } from '../../contracts/IpGeolocator.ts';
import { OutcomeResolution } from './OutcomeResolution.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-ip-node
export class ResolveIpNode extends ScalarNode<CartographerState, 'resolved'> {
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

  protected override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    const raw = state.getMetadata('geo-signal');

    if (!GeoSignalDescriptorGuard.is(raw)) {
      state.candidate = GeoResolutionBuilder.from({ 'source': 'ip', 'weight': 0 });
      return NodeOutputBuilder.of('resolved');
    }

    const outcome = await this.ipGeolocator.lookup(raw.ipAddress, context.signal);
    if (outcome.error !== null) {
      state.capturedErrors = [...state.capturedErrors, outcome.error];
    }
    state.candidate = OutcomeResolution.of(outcome, 'ip', raw.weight);
    return NodeOutputBuilder.of('resolved');
  }
}
// #endregion resolve-ip-node
