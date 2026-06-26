import type { CartographerState } from '../../CartographerState.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import {
  NodeOutputBuilder,
  ScalarNode,
  type NodeContextType,
  type NodeOutputType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

type SignalRoute = 'coords' | 'address' | 'ip' | 'code' | 'phone' | 'locale' | 'none';

// #region route-signal-node
export class RouteSignalNode extends ScalarNode<CartographerState, SignalRoute> {
  readonly 'name' = 'route-signal';
  readonly 'outputs' = ['coords', 'address', 'ip', 'code', 'phone', 'locale', 'none'] as const;

  override get outputSchema(): Record<SignalRoute, SchemaObjectType> {
    return {
      'coords':  { 'type': 'object' },
      'address': { 'type': 'object' },
      'ip':      { 'type': 'object' },
      'code':    { 'type': 'object' },
      'phone':   { 'type': 'object' },
      'locale':  { 'type': 'object' },
      'none':    { 'type': 'object' },
    };
  }

  protected override async executeOne(
    state: CartographerState,
    _context: NodeContextType,
  ): Promise<NodeOutputType<SignalRoute>> {
    const raw = state.getMetadata('geo-signal');
    if (!GeoSignalDescriptorGuard.is(raw)) {
      return NodeOutputBuilder.of('none');
    }
    return NodeOutputBuilder.of(raw.kind);
  }
}

export const routeSignal = new RouteSignalNode();
// #endregion route-signal-node
