import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { CallingCode } from '../../geo/CallingCode.ts';
import { CountryCodeResolution } from './CountryCodeResolution.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-phone-node
export class ResolvePhoneNode extends ScalarNode<CartographerState, 'resolved'> {
  readonly 'name' = 'resolve-phone';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  protected override async executeOne(
    state: CartographerState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    const raw = state.getMetadata('geo-signal');

    if (!GeoSignalDescriptorGuard.is(raw)) {
      state.candidate = GeoResolutionBuilder.from({ 'source': 'phone', 'weight': 0 });
      return NodeOutputBuilder.of('resolved');
    }

    const iso2 = CallingCode.countryFor(raw.phone);
    if (iso2 === '') {
      state.candidate = GeoResolutionBuilder.from({ 'source': 'phone', 'weight': 0 });
    } else {
      state.candidate = CountryCodeResolution.forIso2(iso2, 'phone', raw.weight);
    }
    return NodeOutputBuilder.of('resolved');
  }
}

export const resolvePhone = new ResolvePhoneNode();
// #endregion resolve-phone-node
