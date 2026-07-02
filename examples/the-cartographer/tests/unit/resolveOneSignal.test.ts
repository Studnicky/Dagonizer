/**
 * Unit tests for the per-concept geo resolver nodes.
 *
 * Each node is tested via a thin public-proxy subclass (widening the protected
 * executeOne to public), with fake DI transports that return canned outcomes
 * for ip/address nodes. No DAG engine or real network calls are involved.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer/types';
import type { GeoLookupOutcomeType } from '../../errors/GeoLookupOutcome.ts';
import type { GeoCandidate } from '../../entities/GeoCandidate.ts';
import type { IpGeolocator } from '../../contracts/IpGeolocator.ts';
import type { AddressGeocoder } from '../../contracts/AddressGeocoder.ts';

import { GeoLookupOutcome } from '../../errors/GeoLookupOutcome.ts';
import { GeoErrorRecord } from '../../errors/GeoErrorRecord.ts';
import { GeoSignalDescriptorBuilder } from '../../entities/GeoSignalDescriptor.ts';
import { CartographerState } from '../../CartographerState.ts';
import { ResolveCoordsNode } from '../../nodes/geo/resolveCoords.ts';
import { ResolveLocaleNode } from '../../nodes/geo/resolveLocale.ts';
import { ResolveCodeNode } from '../../nodes/geo/resolveCode.ts';
import { ResolvePhoneNode } from '../../nodes/geo/resolvePhone.ts';
import { ResolveNoneNode } from '../../nodes/geo/resolveNone.ts';
import { ResolveIpNode } from '../../nodes/geo/resolveIp.ts';
import { ResolveAddressNode } from '../../nodes/geo/resolveAddress.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds GeoCandidate fixtures for resolver-node tests. */
class GeoCandidateFixture {
  /** Minimal resolved GeoCandidate for a given ISO-2 country. */
  static for(country: string, overrides: Partial<GeoCandidate> = {}): GeoCandidate {
    return {
      'modality':    'ip',
      'resolved':    true,
      'country':     country,
      'countryName': country === 'DE' ? 'Germany' : country,
      'continent':   '',
      'region':      '',
      'locality':    '',
      'lat':         0,
      'lng':         0,
      'water':       false,
      ...overrides,
    };
  }

  /** Unresolved GeoCandidate (transport found nothing usable). */
  static unresolved(): GeoCandidate {
    return {
      'modality':    'ip',
      'resolved':    false,
      'country':     '',
      'countryName': '',
      'continent':   '',
      'region':      '',
      'locality':    '',
      'lat':         0,
      'lng':         0,
      'water':       false,
    };
  }
}

// ---------------------------------------------------------------------------
// Fake transports
// ---------------------------------------------------------------------------

class FakeIpGeolocator implements IpGeolocator {
  private readonly outcome: GeoLookupOutcomeType;
  constructor(outcome: GeoLookupOutcomeType) {
    this.outcome = outcome;
  }
  lookup(_ipAddress: string, _signal: AbortSignal): Promise<GeoLookupOutcomeType> {
    return Promise.resolve(this.outcome);
  }
}

class FakeAddressGeocoder implements AddressGeocoder {
  private readonly outcome: GeoLookupOutcomeType;
  constructor(outcome: GeoLookupOutcomeType) {
    this.outcome = outcome;
  }
  geocode(_address: string, _signal: AbortSignal): Promise<GeoLookupOutcomeType> {
    return Promise.resolve(this.outcome);
  }
}

// ---------------------------------------------------------------------------
// Public proxy subclasses (widening protected executeOne)
// ---------------------------------------------------------------------------

class PublicResolveCoordsNode extends ResolveCoordsNode {
  public override executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    return super.executeOne(state, context);
  }
}

class PublicResolveLocaleNode extends ResolveLocaleNode {
  public override executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    return super.executeOne(state, context);
  }
}

class PublicResolveCodeNode extends ResolveCodeNode {
  public override executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    return super.executeOne(state, context);
  }
}

class PublicResolvePhoneNode extends ResolvePhoneNode {
  public override executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    return super.executeOne(state, context);
  }
}

class PublicResolveNoneNode extends ResolveNoneNode {
  public override executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    return super.executeOne(state, context);
  }
}

class PublicResolveIpNode extends ResolveIpNode {
  public override executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    return super.executeOne(state, context);
  }
}

class PublicResolveAddressNode extends ResolveAddressNode {
  public override executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'resolved'>> {
    return super.executeOne(state, context);
  }
}

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

const CTX: NodeContextType = {
  'dagName': 'test',
  'nodeName': 'resolve-signal',
  'signal': new AbortController().signal,
  'validateOutputs': false,
  'outputSchemaValidator': null,
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('ResolveNoneNode — fallback resolver', () => {
  it('always yields source:"none" weight:0', async () => {
    const state = new CartographerState();
    const node = new PublicResolveNoneNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'none');
    assert.equal(state.candidate.weight, 0);
  });
});

describe('ResolveCoordsNode — non-GeoSignalDescriptor metadata', () => {
  it('yields source:"coords" weight:0 when metadata is missing', async () => {
    const state = new CartographerState();
    const node = new PublicResolveCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'coords');
    assert.equal(state.candidate.weight, 0);
  });

  it('yields source:"coords" weight:0 when metadata is a plain string', async () => {
    const state = new CartographerState();
    state.setMetadata('geo-signal', 'not-a-descriptor');
    const node = new PublicResolveCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'coords');
    assert.equal(state.candidate.weight, 0);
  });
});

describe('ResolveCodeNode — code kind', () => {
  it('resolves a known country code to source:"code" with correct weight', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'code', 'weight': 0.8, 'countryCode': 'DE',
    });
    state.setMetadata('geo-signal', descriptor);
    const node = new PublicResolveCodeNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'code');
    assert.equal(state.candidate.country, 'DE');
    assert.equal(state.candidate.weight, 0.8);
    assert.ok(state.candidate.timezone.length > 0, 'timezone should be non-empty for DE');
  });

  it('yields weight:0 for an unrecognised country code', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'code', 'weight': 0.5, 'countryCode': 'ZZ',
    });
    state.setMetadata('geo-signal', descriptor);
    const node = new PublicResolveCodeNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'code');
    assert.equal(state.candidate.weight, 0);
  });
});

describe('ResolvePhoneNode — phone kind', () => {
  it('resolves a parseable phone number to source:"phone" with correct weight', async () => {
    const state = new CartographerState();
    // +49 prefix → DE
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'phone', 'weight': 0.6, 'phone': '+4915123456789',
    });
    state.setMetadata('geo-signal', descriptor);
    const node = new PublicResolvePhoneNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'phone');
    assert.equal(state.candidate.weight, 0.6);
  });

  it('yields source:"phone" weight:0 when CallingCode returns empty string', async () => {
    const state = new CartographerState();
    // An empty or non-digit phone — CallingCode.countryFor returns ''
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'phone', 'weight': 0.6, 'phone': '',
    });
    state.setMetadata('geo-signal', descriptor);
    const node = new PublicResolvePhoneNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'phone');
    assert.equal(state.candidate.weight, 0);
  });
});

describe('ResolveLocaleNode — locale kind', () => {
  it('resolves a valid BCP-47 locale tag to source:"locale" with correct weight', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'locale', 'weight': 0.4, 'localeTag': 'de-DE',
    });
    state.setMetadata('geo-signal', descriptor);
    const node = new PublicResolveLocaleNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'locale');
    assert.equal(state.candidate.weight, 0.4);
    assert.equal(state.candidate.country, 'DE');
  });
});

describe('ResolveIpNode — ip kind', () => {
  it('resolves a successful IP lookup to source:"ip" with correct weight', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'ip', 'weight': 0.9, 'ipAddress': '8.8.8.8',
    });
    state.setMetadata('geo-signal', descriptor);
    const fakeOutcome = GeoLookupOutcome.resolved(GeoCandidateFixture.for('US'));
    const node = new PublicResolveIpNode(
      new FakeIpGeolocator(fakeOutcome),
    );
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'ip');
    assert.equal(state.candidate.country, 'US');
    assert.equal(state.candidate.weight, 0.9);
  });

  it('yields weight:0 when the IP transport returns resolved:false', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'ip', 'weight': 0.9, 'ipAddress': '0.0.0.0',
    });
    state.setMetadata('geo-signal', descriptor);
    const fakeOutcome = GeoLookupOutcome.resolved(GeoCandidateFixture.unresolved());
    const node = new PublicResolveIpNode(
      new FakeIpGeolocator(fakeOutcome),
    );
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'ip');
    assert.equal(state.candidate.weight, 0);
  });

  it('appends an error to state.capturedErrors when the IP transport returns an error', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'ip', 'weight': 0.7, 'ipAddress': '1.2.3.4',
    });
    state.setMetadata('geo-signal', descriptor);
    const err = GeoErrorRecord.capture('ip-geolocate', new Error('timeout'), '1.2.3.4');
    const fakeOutcome = GeoLookupOutcome.failed(GeoCandidateFixture.unresolved(), err);
    const node = new PublicResolveIpNode(
      new FakeIpGeolocator(fakeOutcome),
    );
    await node.executeOne(state, CTX);
    assert.equal(state.capturedErrors.length, 1);
    assert.equal(state.capturedErrors[0]?.source, 'ip-geolocate');
  });
});

describe('ResolveAddressNode — address kind', () => {
  it('resolves a successful address lookup to source:"address" with correct weight', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'address', 'weight': 0.75, 'address': '1 Infinite Loop, Cupertino',
    });
    state.setMetadata('geo-signal', descriptor);
    const fakeOutcome = GeoLookupOutcome.resolved(
      GeoCandidateFixture.for('US', { 'modality': 'address' }),
    );
    const node = new PublicResolveAddressNode(
      new FakeAddressGeocoder(fakeOutcome),
    );
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'address');
    assert.equal(state.candidate.country, 'US');
    assert.equal(state.candidate.weight, 0.75);
  });

  it('appends an error to state.capturedErrors when the address transport returns an error', async () => {
    const state = new CartographerState();
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'address', 'weight': 0.5, 'address': 'bad address',
    });
    state.setMetadata('geo-signal', descriptor);
    const err = GeoErrorRecord.capture('address-geocode', new Error('HTTP 502'), 'bad address');
    const fakeOutcome = GeoLookupOutcome.failed(
      GeoCandidateFixture.for('', { 'resolved': false }),
      err,
    );
    const node = new PublicResolveAddressNode(
      new FakeAddressGeocoder(fakeOutcome),
    );
    await node.executeOne(state, CTX);
    assert.equal(state.capturedErrors.length, 1);
    assert.equal(state.capturedErrors[0]?.source, 'address-geocode');
  });
});

describe('ResolveCoordsNode — coords kind', () => {
  it('resolves valid coordinates to source:"coords" with the descriptor weight', async () => {
    const state = new CartographerState();
    // London: GeohashTzMap should resolve this well
    const descriptor = GeoSignalDescriptorBuilder.from({
      'kind': 'coords', 'weight': 1.0, 'lat': 51.5074, 'lng': -0.1278,
    });
    state.setMetadata('geo-signal', descriptor);
    const node = new PublicResolveCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'resolved');
    assert.equal(state.candidate.source, 'coords');
    // Weight is non-zero: the table (or fallback) resolved something
    assert.ok(state.candidate.weight > 0, 'weight should be positive for a resolvable coordinate');
  });
});
