import type { CartographerState } from '../../CartographerState.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { CountryCodeResolution } from './CountryCodeResolution.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region resolve-code-node
export class ResolveCodeNode extends ScalarNode<CartographerState, 'resolved'> {
  readonly 'name' = 'resolve-code';
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
      state.candidate = GeoResolutionBuilder.from({ 'source': 'code', 'weight': 0 });
      return NodeOutputBuilder.of('resolved');
    }

    state.candidate = CountryCodeResolution.forIso2(raw.countryCode, 'code', raw.weight);
    return NodeOutputBuilder.of('resolved');
  }
}

export const resolveCode = new ResolveCodeNode();
// #endregion resolve-code-node
