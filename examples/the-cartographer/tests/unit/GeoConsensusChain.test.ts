/**
 * Unit tests: the layered-consensus geo node chain — resolve-country-consensus,
 * verify-point-containment, assemble-resolved-geo. Each node is tested through
 * the public batch execution contract (matches the pattern in resolveOneSignal.test.ts).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Batch } from '@studnicky/dagonizer';
import type { MonadicNode, NodeContextType } from '@studnicky/dagonizer';

import { CartographerState } from '../../CartographerState.ts';
import type { GeoResolution } from '../../entities/GeoResolution.ts';
import { GeoConsensusGuard } from '../../entities/GeoConsensus.ts';
import { GeoPositionGuard } from '../../entities/GeoPosition.ts';
import { ResolveCountryConsensusNode } from '../../nodes/geo/resolveCountryConsensus.ts';
import { VerifyPointContainmentNode } from '../../nodes/geo/verifyPointContainment.ts';
import { AssembleResolvedGeoNode } from '../../nodes/geo/assembleResolvedGeo.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────────

class FixtureCandidate {
  static of(overrides: Partial<GeoResolution>): GeoResolution {
    return {
      'source':       'coords',
      'secondaryLookupUsed': false,
      'timezone':     '',
      'country':      '',
      'countryName':  '',
      'locale':       '',
      'region':       '',
      'locality':     '',
      'lat':          0,
      'lng':          0,
      'status':       'land',
      'weight':       0,
      ...overrides,
    };
  }
}

const CTX: NodeContextType = {
  'dagName': 'test',
  'nodeName': 'geo-consensus-chain',
  'signal': new AbortController().signal,
  'validateOutputs': false,
  'outputSchemaValidator': null,
};

async function executeSingle<TOutput extends string>(
  node: MonadicNode<CartographerState, TOutput>,
  state: CartographerState,
): Promise<TOutput> {
  const routed = await node.execute(Batch.of(state), CTX);
  for (const [output, batch] of routed) {
    if (batch.size > 0) return output;
  }
  throw new Error(`Node ${node.name} did not route the test item`);
}

/** Runs the full 3-node chain against a fixed set of accumulated candidates. */
async function runChain(candidates: GeoResolution[]): Promise<CartographerState> {
  const state = new CartographerState();
  state.geoCandidates = candidates;
  await executeSingle(new ResolveCountryConsensusNode(), state);
  await executeSingle(new VerifyPointContainmentNode(), state);
  await executeSingle(new AssembleResolvedGeoNode(), state);
  return state;
}

// ── resolve-country-consensus ───────────────────────────────────────────────

describe('ResolveCountryConsensusNode', () => {
  it('a single country-bearing candidate becomes the unanimous consensus', async () => {
    const state = new CartographerState();
    state.geoCandidates = [FixtureCandidate.of({ 'source': 'code', 'weight': 0.35, 'country': 'DE' })];
    await executeSingle(new ResolveCountryConsensusNode(), state);

    const consensus = state.getMetadata('geo-consensus');
    assert.ok(GeoConsensusGuard.is(consensus));
    assert.equal(consensus.country, 'DE');
    assert.equal(consensus.weight, 0.35);
    assert.equal(consensus.agreementCount, 1);
    assert.equal(consensus.unanimous, true);
  });

  it('three modest-weight signals agreeing on a country outweigh one strong signal on a different country', async () => {
    const state = new CartographerState();
    // Agreeing group: code(0.35) + phone(0.30) + locale(0.2) = 0.85 on 'DE'.
    // Lone dissenting group: ip(0.55) alone on 'FR'.
    state.geoCandidates = [
      FixtureCandidate.of({ 'source': 'ip',     'weight': 0.55, 'country': 'FR' }),
      FixtureCandidate.of({ 'source': 'code',   'weight': 0.35, 'country': 'DE' }),
      FixtureCandidate.of({ 'source': 'phone',  'weight': 0.30, 'country': 'DE' }),
      FixtureCandidate.of({ 'source': 'locale', 'weight': 0.20, 'country': 'DE' }),
    ];
    await executeSingle(new ResolveCountryConsensusNode(), state);

    const consensus = state.getMetadata('geo-consensus');
    assert.ok(GeoConsensusGuard.is(consensus));
    assert.equal(consensus.country, 'DE', 'summed agreement beats a single higher-weight dissenter');
    assert.equal(consensus.agreementCount, 3);
    assert.ok(Math.abs(consensus.weight - 0.85) < 1e-9);
    assert.equal(consensus.unanimous, false, 'two competing identity groups existed');
  });

  it('water-status candidates form their own pseudo-group, separate from any country', async () => {
    const state = new CartographerState();
    state.geoCandidates = [FixtureCandidate.of({ 'source': 'coords', 'weight': 1.0, 'status': 'water', 'country': '' })];
    await executeSingle(new ResolveCountryConsensusNode(), state);

    const consensus = state.getMetadata('geo-consensus');
    assert.ok(GeoConsensusGuard.is(consensus));
    assert.equal(consensus.isWater, true);
    assert.equal(consensus.country, '');
  });

  it('candidates with no country and not water route to no-consensus without writing a verdict', async () => {
    const state = new CartographerState();
    state.geoCandidates = [FixtureCandidate.of({ 'source': 'coords', 'weight': 1.0, 'country': '', 'timezone': 'Africa/Lagos' })];
    const output = await executeSingle(new ResolveCountryConsensusNode(), state);

    assert.equal(output, 'no-consensus', 'no candidate carried a country/water identity — nothing to agree on');
    assert.equal(state.getMetadata('geo-consensus'), undefined, 'no-consensus leaves geo-consensus unwritten; flag-geo-for-review handles this branch');
  });

  it('a single agreeing candidate below the consensus share floor still reaches consensus (unanimous, nothing to tie-break)', async () => {
    const state = new CartographerState();
    state.geoCandidates = [FixtureCandidate.of({ 'source': 'phone', 'weight': 0.30, 'country': 'DE' })];
    const output = await executeSingle(new ResolveCountryConsensusNode(), state);

    assert.equal(output, 'consensus', 'one identity group has nothing to tie-break against, regardless of absolute weight');
    const consensus = state.getMetadata('geo-consensus');
    assert.ok(GeoConsensusGuard.is(consensus));
    assert.equal(consensus.country, 'DE');
  });

  it('two closely-matched competing groups route to no-consensus (too close to call)', async () => {
    const state = new CartographerState();
    // DE: ip(0.55) = 0.55; FR: address(0.8) - too close/insufficient share for DE... use a real near-tie instead.
    state.geoCandidates = [
      FixtureCandidate.of({ 'source': 'ip',      'weight': 0.55, 'country': 'DE' }),
      FixtureCandidate.of({ 'source': 'address',  'weight': 0.55, 'country': 'FR' }),
    ];
    const output = await executeSingle(new ResolveCountryConsensusNode(), state);

    assert.equal(output, 'no-consensus', 'two equal-weight groups on different countries is a genuine tie, not a consensus');
    assert.equal(state.getMetadata('geo-consensus'), undefined);
  });
});

// ── verify-point-containment ────────────────────────────────────────────────

describe('VerifyPointContainmentNode', () => {
  it('a point that reverse-geocodes to the consensus country is verified, no conflict', async () => {
    const state = new CartographerState();
    state.geoCandidates = [FixtureCandidate.of({
      'source': 'coords', 'weight': 1.0, 'country': 'DE', 'lat': 52.5, 'lng': 13.4,
    })];
    await executeSingle(new ResolveCountryConsensusNode(), state);
    await executeSingle(new VerifyPointContainmentNode(), state);

    const position = state.getMetadata('geo-position');
    assert.ok(GeoPositionGuard.is(position));
    assert.equal(position.positionSource, 'verified-point');
    assert.equal(position.pointSource, 'coords');
    assert.equal(position.conflict, false);
    assert.equal(position.lat, 52.5);
    assert.equal(position.lng, 13.4);
  });

  it('a point that reverse-geocodes to a DIFFERENT country than consensus is used but flagged as a conflict', async () => {
    const state = new CartographerState();
    // Berlin coords (real point → DE), but the consensus country is forced to FR
    // via a higher-weight-summed dissenting group, to exercise disagreement.
    state.geoCandidates = [
      FixtureCandidate.of({ 'source': 'coords', 'weight': 0.10, 'country': '', 'lat': 52.5, 'lng': 13.4 }),
      FixtureCandidate.of({ 'source': 'code',   'weight': 0.90, 'country': 'FR' }),
    ];
    await executeSingle(new ResolveCountryConsensusNode(), state);
    await executeSingle(new VerifyPointContainmentNode(), state);

    const position = state.getMetadata('geo-position');
    assert.ok(GeoPositionGuard.is(position));
    assert.equal(position.positionSource, 'verified-point', 'the point is still used as the position');
    assert.equal(position.conflict, true);
    assert.equal(position.conflictCountry, 'DE');
    // The point's own coordinates are preserved even though it disagrees.
    assert.equal(position.lat, 52.5);
    assert.equal(position.lng, 13.4);
  });

  it('no valid point candidate falls back to the consensus country centroid', async () => {
    const state = new CartographerState();
    state.geoCandidates = [FixtureCandidate.of({ 'source': 'code', 'weight': 0.35, 'country': 'DE', 'lat': 0, 'lng': 0 })];
    await executeSingle(new ResolveCountryConsensusNode(), state);
    await executeSingle(new VerifyPointContainmentNode(), state);

    const position = state.getMetadata('geo-position');
    assert.ok(GeoPositionGuard.is(position));
    assert.equal(position.positionSource, 'centroid-fallback');
    assert.ok(position.lat !== 0 || position.lng !== 0, 'centroid must be a real point for DE');
  });

  it('no point and no consensus country leaves the position empty', async () => {
    const state = new CartographerState();
    state.geoCandidates = [];
    await executeSingle(new ResolveCountryConsensusNode(), state);
    await executeSingle(new VerifyPointContainmentNode(), state);

    const position = state.getMetadata('geo-position');
    assert.ok(GeoPositionGuard.is(position));
    assert.equal(position.positionSource, 'none');
    assert.equal(position.lat, 0);
    assert.equal(position.lng, 0);
  });
});

// ── assemble-resolved-geo (full chain) ──────────────────────────────────────

describe('AssembleResolvedGeoNode (via the full 3-node chain)', () => {
  it('a single high-weight candidate reduces confidence to that candidate\'s own weight', async () => {
    const state = await runChain([
      FixtureCandidate.of({ 'source': 'coords', 'weight': 1.0, 'country': 'DE', 'countryName': 'Germany', 'lat': 52.5, 'lng': 13.4, 'timezone': 'Europe/Berlin' }),
    ]);
    assert.ok(Math.abs(state.resolvedGeo.confidence - 1.0) < 1e-9);
    assert.equal(state.resolvedGeo.country, 'DE');
    assert.deepEqual(state.resolvedGeo.provenance, ['coords']);
    assert.ok(state.resolvedGeo.modalities.includes('gps'));
  });

  it('three independently agreeing modest-weight signals outscore one stronger solo signal', async () => {
    // code(0.35) + phone(0.30) + locale(0.2), all agreeing on DE: noisy-OR
    // 1 - (0.65 * 0.70 * 0.80) ≈ 0.636.
    const agreeing = await runChain([
      FixtureCandidate.of({ 'source': 'code',   'weight': 0.35, 'country': 'DE' }),
      FixtureCandidate.of({ 'source': 'phone',  'weight': 0.30, 'country': 'DE' }),
      FixtureCandidate.of({ 'source': 'locale', 'weight': 0.20, 'country': 'DE' }),
    ]);
    // One solo candidate at weight 0.55 — stronger than any individual agreeing
    // signal above, but weaker than their combined agreement.
    const solo = await runChain([
      FixtureCandidate.of({ 'source': 'ip', 'weight': 0.55, 'country': 'DE' }),
    ]);

    assert.ok(
      agreeing.resolvedGeo.confidence > solo.resolvedGeo.confidence,
      `expected agreeing confidence (${agreeing.resolvedGeo.confidence}) > solo confidence (${solo.resolvedGeo.confidence})`,
    );
  });

  it('region/locality/timezone back-fill only draws from candidates agreeing with consensus', async () => {
    const state = await runChain([
      FixtureCandidate.of({ 'source': 'coords', 'weight': 1.0, 'country': 'DE', 'region': '' }),
      FixtureCandidate.of({ 'source': 'ip',     'weight': 0.55, 'country': 'DE', 'region': 'Berlin State' }),
      // A disagreeing candidate with a region value must NOT be used for back-fill.
      FixtureCandidate.of({ 'source': 'code',   'weight': 0.35, 'country': 'FR', 'region': 'Île-de-France' }),
    ]);
    assert.equal(state.resolvedGeo.region, 'Berlin State');
  });

  it('water candidate resolves to the maritime bucket, not Unmapped', async () => {
    const state = await runChain([
      FixtureCandidate.of({
        'source': 'coords', 'weight': 1.0, 'status': 'water', 'country': '',
        'locality': 'North Atlantic Ocean', 'timezone': 'UTC', 'lat': 35, 'lng': -40,
      }),
    ]);
    assert.equal(state.resolvedGeo.country, 'INTL');
    assert.equal(state.resolvedGeo.continent, 'International Waters / Maritime');
    assert.equal(state.resolvedGeo.jurisdiction, 'international-waters');
    assert.equal(state.geoContext.country, 'INTL');
    assert.equal(state.geoContext.status, 'water');
    assert.deepEqual(state.geoContext.waterBodies, ['North Atlantic Ocean']);
  });

  it('zero candidates produces an empty (non-baseline-schema-breaking) assembly', async () => {
    const state = await runChain([]);
    assert.equal(state.resolvedGeo.country, '');
    assert.equal(state.resolvedGeo.confidence, 0);
    assert.deepEqual(state.resolvedGeo.provenance, []);
  });
});
