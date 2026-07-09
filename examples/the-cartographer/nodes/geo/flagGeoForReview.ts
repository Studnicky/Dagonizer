/**
 * flag-geo-for-review: the 'no-consensus' branch of `resolve-country-consensus`.
 * Candidates existed but disagreed too much to trust a single winning country
 * (see the thresholds documented on `resolveCountryConsensus.ts`).
 *
 * `state.resolvedGeo` / `state.geoContext` are schema-required fields that
 * downstream nodes (`applyGeo`, `aggregateEvent`) read unconditionally, so
 * this node still writes them — at baseline/zero-confidence values via
 * `GeoBaseline`, the same source of truth the gather's empty-candidates path
 * uses, rather than picking a side. Sets `state.routing.geoFlaggedForReview`
 * so downstream reporting can distinguish "resolved with nothing to go on"
 * from "resolved but the signals disagreed." Always routes 'resolved'.
 */

import type { CartographerState } from '../../CartographerState.ts';
import { GeoBaseline } from '../../core/GeoBaseline.ts';
import {
  MonadicNode,
  RoutedBatch,
  type Batch,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

// #region flag-geo-for-review-node
export class FlagGeoForReviewNode extends MonadicNode<CartographerState, 'resolved'> {
  readonly '@id' = 'urn:noocodec:node:flag-geo-for-review';
  readonly 'name' = 'flag-geo-for-review';
  readonly 'outputs' = ['resolved'] as const;

  override get outputSchema(): Record<'resolved', SchemaObjectType> {
    return { 'resolved': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'resolved', CartographerState>> {
    for (const item of batch) {
      item.state.resolvedGeo = GeoBaseline.resolvedGeo();
      item.state.geoContext = GeoBaseline.geoContext();
      item.state.routing = { ...item.state.routing, 'geoFlaggedForReview': true };
    }
    return RoutedBatch.create('resolved', batch);
  }
}

export const flagGeoForReview = new FlagGeoForReviewNode();
// #endregion flag-geo-for-review-node
