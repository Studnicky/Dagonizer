/**
 * validateCoords: gates on WGS-84 validity (geo-first; reads raw scan coords).
 *
 * Runs BEFORE normalize in the geo-first pipeline, so it reads the scan
 * coordinates directly from state.raw. Latitude must be in [-90, 90] and
 * longitude in [-180, 180]. Invalid coords route to 'rejected'.
 */

import type { CartographerState } from '../CartographerState.ts';
import { Batch, MonadicNode, NodeOutput } from '@studnicky/dagonizer';
import type { ItemType, NodeContextType, NodeOutputType, RoutedBatchType, SchemaObjectType } from '@studnicky/dagonizer';

// #region validate-coords-node
export class ValidateCoordsNode extends MonadicNode<CartographerState, 'valid' | 'rejected'> {
  readonly 'name' = 'validate-coords';
  readonly 'outputs' = ['valid', 'rejected'] as const;

  override get outputSchema(): Record<'valid' | 'rejected', SchemaObjectType> {
    return {
      'valid':    { 'type': 'object' },
      'rejected': { 'type': 'object' },
    };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'valid' | 'rejected', CartographerState>> {
    const acc = new Map<'valid' | 'rejected', ItemType<CartographerState>[]>();

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

    const routed = new Map<'valid' | 'rejected', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private routeItem(state: CartographerState): NodeOutputType<'valid' | 'rejected'> {
    const { latitude, longitude } = state.raw;
    const isValid = latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
    return NodeOutput.create(isValid ? 'valid' : 'rejected');
  }
}

export const validateCoords = new ValidateCoordsNode();
// #endregion validate-coords-node
