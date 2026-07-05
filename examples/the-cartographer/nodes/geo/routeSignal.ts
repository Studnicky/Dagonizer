import type { CartographerState } from '../../CartographerState.ts';
import { GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import {
  Batch,
  MonadicNode,
  NodeOutputBuilder,
  type ItemType,
  type NodeContextType,
  type NodeOutputType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

type SignalRoute = 'coords' | 'address' | 'ip' | 'code' | 'phone' | 'locale' | 'none';

// #region route-signal-node
export class RouteSignalNode extends MonadicNode<CartographerState, SignalRoute> {
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

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<SignalRoute, CartographerState>> {
    const acc = new Map<SignalRoute, ItemType<CartographerState>[]>();

    for (const item of batch) {
      const result = this.routeItem(item.state);
      for (const error of result.errors) {
        item.state.collectError(error);
      }
      const bucket = acc.get(result.output);
      if (bucket === undefined) {
        acc.set(result.output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<SignalRoute, Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<SignalRoute> {
    const raw = state.getMetadata('geo-signal');
    if (!GeoSignalDescriptorGuard.is(raw)) {
      return NodeOutputBuilder.of('none');
    }
    return NodeOutputBuilder.of(raw.kind);
  }
}

export const routeSignal = new RouteSignalNode();
// #endregion route-signal-node
