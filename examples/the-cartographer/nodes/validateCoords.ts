/**
 * validateCoords: gates on WGS-84 validity (geo-first; reads raw scan coords).
 *
 * Runs BEFORE normalize in the geo-first pipeline, so it reads the scan
 * coordinates directly from state.raw. Latitude must be in [-90, 90] and
 * longitude in [-180, 180]. Invalid coords route to 'rejected'.
 */

import type { CartographerState } from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import { NodeOutputBuilder, type NodeInterface } from '@noocodex/dagonizer';

// #region validate-coords-node
export const validateCoords: NodeInterface<CartographerState, 'valid' | 'rejected', CartographerServices> = {
  'name': 'validate-coords',
  'outputs': ['valid', 'rejected'],
  async execute(state, context) {
    if (context.signal.aborted) {
      throw new Error('Aborted');
    }
    const { latitude, longitude } = state.raw;
    const isValid = latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
    return NodeOutputBuilder.of(isValid ? 'valid' : 'rejected');
  },
};
// #endregion validate-coords-node
