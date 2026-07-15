/**
 * resolve-country-consensus: groups the accumulated weight>0 `GeoResolution`
 * candidates by ISO-2 country (water-status candidates form their own
 * pseudo-group) and picks the group with the highest SUMMED weight.
 *
 * This is a tie-break between independent agreement groups, not a
 * per-candidate "pick the biggest single weight" rule: three modest-weight
 * signals that agree on a country outrank one high-weight signal alone on a
 * different country, since the point is to use every signal available rather
 * than crown a single winner.
 *
 * Routes 'consensus' when the winning group's agreement clears both of two
 * thresholds, 'no-consensus' otherwise:
 *
 *   - MIN_CONSENSUS_SHARE (0.5): the winning group must hold at least half of
 *     the total weight across every identified group. Below this, no single
 *     country commands even a plurality-turned-majority of the evidence.
 *   - MIN_CONSENSUS_MARGIN (0.15): the winning group must beat the runner-up
 *     group by at least 15% of the total identified weight — a near-tie
 *     guard. Two groups at, say, 0.48/0.45 clear MIN_CONSENSUS_SHARE's
 *     complement narrowly but are too close to call a genuine consensus.
 *
 * A single identity group (unanimous — nothing to tie-break against) always
 * reaches consensus regardless of its absolute weight; the thresholds only
 * apply once two or more groups compete. Zero identity groups (candidates
 * existed but none carried a country/water identity) is unconditionally
 * 'no-consensus' — there is nothing to agree on.
 *
 * On 'consensus', writes the verdict to `state.setMetadata('geo-consensus', ...)`
 * for the downstream `verify-point-containment` and `assemble-resolved-geo`
 * nodes. On 'no-consensus', writes nothing — the `flag-geo-for-review` node
 * downstream writes baseline values directly.
 */

import type { CartographerState } from '../../CartographerState.ts';
import { GeoConsensusBuilder } from '../../entities/GeoConsensus.ts';
import { CountryCodes } from '../../services.ts';
import {
  Batch,
  MonadicNode,
  type ItemType,
  type NodeContextType,
  type RoutedBatchType,
  type SchemaObjectType,
} from '@studnicky/dagonizer';

interface IdentityGroup {
  country: string;
  isWater: boolean;
  weight: number;
  sources: Set<string>;
}

const MIN_CONSENSUS_SHARE = 0.5;
const MIN_CONSENSUS_MARGIN = 0.15;

// #region resolve-country-consensus-node
export class ResolveCountryConsensusNode extends MonadicNode<CartographerState, 'consensus' | 'no-consensus'> {
  readonly '@id' = 'urn:noocodec:node:resolve-country-consensus';
  readonly 'name' = 'resolve-country-consensus';
  readonly 'outputs' = ['consensus', 'no-consensus'] as const;

  override get outputSchema(): Record<'consensus' | 'no-consensus', SchemaObjectType> {
    return { 'consensus': { 'type': 'object' }, 'no-consensus': { 'type': 'object' } };
  }

  override async execute(
    batch: Batch<CartographerState>,
    _context: NodeContextType,
  ): Promise<RoutedBatchType<'consensus' | 'no-consensus', CartographerState>> {
    const acc = new Map<'consensus' | 'no-consensus', ItemType<CartographerState>[]>();

    for (const item of batch) {
      const output = ResolveCountryConsensusNode.resolveItem(item.state);
      const bucket = acc.get(output);
      if (bucket === undefined) {
        acc.set(output, [item]);
      } else {
        bucket.push(item);
      }
    }

    const routed = new Map<'consensus' | 'no-consensus', Batch<CartographerState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private static resolveItem(state: CartographerState): 'consensus' | 'no-consensus' {
    const groups = new Map<string, IdentityGroup>();

    for (const candidate of state.geoCandidates) {
      const isWater = candidate.status === 'water';
      const iso2 = isWater ? '' : CountryCodes.toIso2(candidate.country);
      const key = isWater ? '__water__' : iso2;
      if (key.length === 0) continue; // no country/water identity — not a consensus candidate

      let group = groups.get(key);
      if (group === undefined) {
        group = { 'country': iso2, 'isWater': isWater, 'weight': 0, 'sources': new Set() };
        groups.set(key, group);
      }
      group.weight += candidate.weight;
      group.sources.add(candidate.source);
    }

    if (groups.size === 0) return 'no-consensus';

    const sorted = [...groups.values()].sort((a, b) => b.weight - a.weight);
    const winner = sorted[0];
    if (winner === undefined) return 'no-consensus';

    if (sorted.length > 1) {
      const totalWeight = sorted.reduce((sum, group) => sum + group.weight, 0);
      const runnerUp = sorted[1];
      const runnerUpWeight = runnerUp?.weight ?? 0;
      const share = totalWeight > 0 ? winner.weight / totalWeight : 0;
      const margin = totalWeight > 0 ? (winner.weight - runnerUpWeight) / totalWeight : 0;
      if (share < MIN_CONSENSUS_SHARE || margin < MIN_CONSENSUS_MARGIN) return 'no-consensus';
    }

    state.setMetadata('geo-consensus', GeoConsensusBuilder.from({
      'country':        winner.country,
      'isWater':        winner.isWater,
      'weight':         winner.weight,
      'agreementCount': winner.sources.size,
      'sources':        [...winner.sources],
      'unanimous':      groups.size <= 1,
    }));
    return 'consensus';
  }
}

export const resolveCountryConsensus = new ResolveCountryConsensusNode();
// #endregion resolve-country-consensus-node
