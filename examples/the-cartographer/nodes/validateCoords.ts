/**
 * validateCoords: gates on WGS-84 validity (geo-first; reads raw scan coords).
 *
 * Runs BEFORE normalize in the geo-first pipeline, so it reads the scan
 * coordinates directly from state.raw. Latitude must be in [-90, 90] and
 * longitude in [-180, 180]. Invalid coords route to 'rejected'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface,
  ScalarNode,
} from '@studnicky/dagonizer';

// #region validate-coords-node
export class ValidateCoordsNode extends ScalarNode<CartographerState, 'valid' | 'rejected', CartographerServices> {
  readonly 'name' = 'validate-coords';
  readonly 'outputs' = ['valid', 'rejected'] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<'valid' | 'rejected'>> {
    const { latitude, longitude } = state.raw;
    const isValid = latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
    return NodeOutputBuilder.of(isValid ? 'valid' : 'rejected');
  }
}

export const validateCoords = new ValidateCoordsNode();
// #endregion validate-coords-node
