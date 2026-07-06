import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GeoSignalDescriptorBuilder, GeoSignalDescriptorGuard } from '../../entities/GeoSignalDescriptor.ts';
import { SourcePayloadGuard } from '../../entities/SourcePayload.ts';
import { CanonicalEventVariantBuilder } from '../../entities/CanonicalEvent.ts';
import { EnrichedShipmentGuard } from '../../entities/EnrichedShipment.ts';
import { GeoErrorRecord } from '../../errors/GeoErrorRecord.ts';

describe('schema-backed entity guards', () => {
  it('SourcePayloadGuard accepts schema-valid source payloads', () => {
    assert.equal(SourcePayloadGuard.is({
      'sourceId':    'fixtures',
      'format':      'json',
      'compression': 'none',
      'mappingKey':  'default',
      'eventType':   'position-ping',
      'payload':     '[]',
    }), true);
  });

  it('SourcePayloadGuard rejects extra properties through the compiled schema', () => {
    assert.equal(SourcePayloadGuard.is({
      'sourceId':    'fixtures',
      'format':      'json',
      'compression': 'none',
      'mappingKey':  'default',
      'eventType':   'position-ping',
      'payload':     '[]',
      'extra':       true,
    }), false);
  });

  it('GeoSignalDescriptorGuard accepts schema-valid descriptors', () => {
    assert.equal(GeoSignalDescriptorGuard.is(GeoSignalDescriptorBuilder.from({
      'kind':   'coords',
      'weight': 1,
      'lat':    40.7,
      'lng':    -74,
    })), true);
  });

  it('GeoSignalDescriptorGuard rejects extra properties through the compiled schema', () => {
    assert.equal(GeoSignalDescriptorGuard.is({
      ...GeoSignalDescriptorBuilder.from({
        'kind':   'coords',
        'weight': 1,
        'lat':    40.7,
        'lng':    -74,
      }),
      'extra': true,
    }), false);
  });

  it('CanonicalEventVariantBuilder.is accepts a schema-valid variant', () => {
    assert.equal(CanonicalEventVariantBuilder.is(CanonicalEventVariantBuilder.from({})), true);
  });

  it('CanonicalEventVariantBuilder.is rejects additional properties and invalid discriminants', () => {
    assert.equal(CanonicalEventVariantBuilder.is({
      ...CanonicalEventVariantBuilder.from({}),
      'eventType': 'invalid-event-type',
      'extra':    true,
    } as unknown), false);
  });

  it('EnrichedShipmentGuard accepts a complete schema-valid enriched shipment', () => {
    const richShipment = {
      'shipmentId':       'SHP-001',
      'scanSeq':          1,
      'epochMs':          1_700_000_000_000,
      'localIso':         '2023-11-14T21:46:40+00:00',
      'utcOffset':        '+00:00',
      'timezone':         'UTC',
      'jurisdiction':     'baseline',
      'continent':        'Europe',
      'region':           'Western Europe',
      'country':          'DE',
      'hub':              'FRA',
      'geoStatus':        'land',
      'lat':              50.1,
      'lng':              8.7,
      'coordsCoarsened':  false,
      'legKm':            100,
      'status':           'SCAN',
      'serviceTier':      'standard',
      'sizeTier':         'small',
      'onTime':           true,
      'exception':        false,
      'consentStatus':    'valid',
      'disruptionReason': '',
      'subtotalUsdMinor': 5000,
      'currency':         'USD',
      'shippingUsdMinor': 1200,
      'distanceKm':       100,
      'transitHours':     24,
      'delayHours':       0,
      'redactionApplied': false,
      'redactedSample':   { 'recipientName': '', 'recipientEmail': '', 'recipientPhone': '' },
      'routing': {
        'path':                'order',
        'geoLookupRun':        false,
        'geoLookupSkipped':    false,
        'ipGeolocateRun':      false,
        'ipGeolocateSkipped':  false,
        'geoConfidence':       0,
        'geoModalities':       [],
        'geoSourceModel':      '',
        'geoFallbackUsed':     false,
        'redactionRun':        false,
        'redactionSkipped':    false,
        'pricingRun':          false,
        'pricingSkipped':      false,
        'etaRun':              false,
        'etaSkipped':          false,
        'coldChainRun':        false,
        'customsDwellRun':     false,
      },
    };
    assert.equal(EnrichedShipmentGuard.is(richShipment), true);
  });

  it('EnrichedShipmentGuard rejects unknown top-level properties', () => {
    const richShipment = {
      'shipmentId':       'SHP-001',
      'scanSeq':          1,
      'epochMs':          1_700_000_000_000,
      'localIso':         '2023-11-14T21:46:40+00:00',
      'utcOffset':        '+00:00',
      'timezone':         'UTC',
      'jurisdiction':     'baseline',
      'continent':        'Europe',
      'region':           'Western Europe',
      'country':          'DE',
      'hub':              'FRA',
      'geoStatus':        'land',
      'lat':              50.1,
      'lng':              8.7,
      'coordsCoarsened':  false,
      'legKm':            100,
      'status':           'SCAN',
      'serviceTier':      'standard',
      'sizeTier':         'small',
      'onTime':           true,
      'exception':        false,
      'consentStatus':    'valid',
      'disruptionReason': '',
      'subtotalUsdMinor': 5000,
      'currency':         'USD',
      'shippingUsdMinor': 1200,
      'distanceKm':       100,
      'transitHours':     24,
      'delayHours':       0,
      'redactionApplied': false,
      'redactedSample':   { 'recipientName': '', 'recipientEmail': '', 'recipientPhone': '' },
      'routing': {
        'path':                'order',
        'geoLookupRun':        false,
        'geoLookupSkipped':    false,
        'ipGeolocateRun':      false,
        'ipGeolocateSkipped':  false,
        'geoConfidence':       0,
        'geoModalities':       [],
        'geoSourceModel':      '',
        'geoFallbackUsed':     false,
        'redactionRun':        false,
        'redactionSkipped':    false,
        'pricingRun':          false,
        'pricingSkipped':      false,
        'etaRun':              false,
        'etaSkipped':          false,
        'coldChainRun':        false,
        'customsDwellRun':     false,
      },
      'extra': 'forbidden',
    };
    assert.equal(EnrichedShipmentGuard.is(richShipment), false);
  });

  it('GeoErrorRecord.is rejects unknown properties and uses schema validation', () => {
    const record = GeoErrorRecord.capture('parse-json', new Error('bad'), 'payload');
    assert.equal(GeoErrorRecord.is({ ...record, 'extra': true } as unknown), false);
  });

  it('GeoErrorRecord.isArray rejects any non-conforming record in the array', () => {
    const valid = GeoErrorRecord.capture('parse-json', new Error('bad'), 'payload');
    const invalid = { ...valid, source: 123 };
    assert.equal(GeoErrorRecord.isArray([valid, invalid]), false);
  });
});
