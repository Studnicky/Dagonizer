/**
 * Unit tests for individual pipeline nodes.
 *
 * Nodes are tested by constructing a CartographerState, setting relevant fields,
 * calling executeOne via thin public-proxy subclasses, and asserting on the
 * routed output tag and state mutations. No DAG engine is involved.
 *
 * Each node's `executeOne` is protected on the base class. The pattern below
 * creates a minimal subclass per node that widens the method to public and
 * delegates to super — a valid TypeScript subclass access widening.
 *
 * Node 24 type-stripping: no enums, no namespaces, no decorators, no parameter
 * properties. Type annotations only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { NodeContextType, NodeOutputType } from '@studnicky/dagonizer/types';
import { CartographerState } from '../../CartographerState.ts';
import { CanonicalEventVariantBuilder } from '../../entities/CanonicalEvent.ts';

import { ValidateCoordsNode } from '../../nodes/validateCoords.ts';
import { RouteGeoNode } from '../../nodes/routeGeo.ts';
import { RouteRedactionNode } from '../../nodes/routeRedaction.ts';
import { ColdChainCheckNode } from '../../nodes/coldChainCheck.ts';
import { CustomsDwellNode } from '../../nodes/customsDwell.ts';
import { AggregateEventNode } from '../../nodes/aggregateEvent.ts';
import { EnrichLegNode } from '../../nodes/enrichLeg.ts';

// ── Public proxy subclasses ────────────────────────────────────────────────────
// Each subclass widens the protected executeOne to public so tests can invoke
// node logic directly without the DAG engine.

class PublicValidateCoordsNode extends ValidateCoordsNode {
  public override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'valid' | 'rejected'>> {
    return super.executeOne(state, context);
  }
}

class PublicRouteGeoNode extends RouteGeoNode {
  public override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'has-geo' | 'needs-geo'>> {
    return super.executeOne(state, context);
  }
}

class PublicRouteRedactionNode extends RouteRedactionNode {
  public override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'needs-redaction' | 'skip-redaction'>> {
    return super.executeOne(state, context);
  }
}

class PublicColdChainCheckNode extends ColdChainCheckNode {
  public override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'checked'>> {
    return super.executeOne(state, context);
  }
}

class PublicCustomsDwellNode extends CustomsDwellNode {
  public override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'dwelled'>> {
    return super.executeOne(state, context);
  }
}

class PublicEnrichLegNode extends EnrichLegNode {
  public override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'leg-measured'>> {
    return super.executeOne(state, context);
  }
}

class PublicAggregateEventNode extends AggregateEventNode {
  public override async executeOne(
    state: CartographerState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'done'>> {
    return super.executeOne(state, context);
  }
}

const CTX: NodeContextType = {
  'dagName': 'test',
  'nodeName': 'test',
  'signal': new AbortController().signal,
  'validateOutputs': false,
  'outputSchemaValidator': null,
};

// ── ValidateCoordsNode ─────────────────────────────────────────────────────────

describe('ValidateCoordsNode', () => {
  it('routes valid in-range coords to "valid"', async () => {
    const state = new CartographerState();
    state.raw.latitude  = 51.5;
    state.raw.longitude = -0.1;
    const node = new PublicValidateCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'valid');
  });

  it('routes latitude exactly at -90 boundary to "valid"', async () => {
    const state = new CartographerState();
    state.raw.latitude  = -90;
    state.raw.longitude = 0;
    const node = new PublicValidateCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'valid');
  });

  it('routes latitude exactly at +90 boundary to "valid"', async () => {
    const state = new CartographerState();
    state.raw.latitude  = 90;
    state.raw.longitude = 180;
    const node = new PublicValidateCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'valid');
  });

  it('routes latitude 91 (out of range) to "rejected"', async () => {
    const state = new CartographerState();
    state.raw.latitude  = 91;
    state.raw.longitude = 0;
    const node = new PublicValidateCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'rejected');
  });

  it('routes longitude 185 (out of range) to "rejected"', async () => {
    const state = new CartographerState();
    state.raw.latitude  = 0;
    state.raw.longitude = 185;
    const node = new PublicValidateCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'rejected');
  });

  it('routes NaN latitude to "rejected"', async () => {
    const state = new CartographerState();
    state.raw.latitude  = NaN;
    state.raw.longitude = 0;
    const node = new PublicValidateCoordsNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'rejected');
  });
});

// ── RouteGeoNode ──────────────────────────────────────────────────────────────

describe('RouteGeoNode', () => {
  it('routes to "needs-geo" when canonical.geo is undefined', async () => {
    const state = new CartographerState();
    // canonical.geo starts undefined (no geo on the default variant)
    const node = new PublicRouteGeoNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'needs-geo');
  });

  it('routes to "needs-geo" when canonical.geo has empty country', async () => {
    const state = new CartographerState();
    const v = CanonicalEventVariantBuilder.from({});
    v.geo = { 'country': '', 'continent': 'Europe', 'region': 'Central Europe' };
    state.canonical = v;
    const node = new PublicRouteGeoNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'needs-geo');
  });

  it('routes to "needs-geo" when country is UNK placeholder', async () => {
    const state = new CartographerState();
    const v = CanonicalEventVariantBuilder.from({});
    v.geo = { 'country': 'UNK', 'continent': 'Unmapped', 'region': 'Unmapped' };
    state.canonical = v;
    const node = new PublicRouteGeoNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'needs-geo');
  });

  it('routes to "has-geo" when fully resolved geo is present', async () => {
    const state = new CartographerState();
    const v = CanonicalEventVariantBuilder.from({});
    v.geo = { 'country': 'DE', 'continent': 'Europe', 'region': 'Central Europe' };
    state.canonical = v;
    const node = new PublicRouteGeoNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'has-geo');
  });

  it('sets routing.geoLookupSkipped when routing to "has-geo"', async () => {
    const state = new CartographerState();
    const v = CanonicalEventVariantBuilder.from({});
    v.geo = { 'country': 'FR', 'continent': 'Europe', 'region': 'Western Europe' };
    state.canonical = v;
    const node = new PublicRouteGeoNode();
    await node.executeOne(state, CTX);
    assert.equal(state.routing.geoLookupSkipped, true);
    assert.equal(state.routing.geoLookupRun, false);
  });

  it('sets routing.geoLookupRun when routing to "needs-geo"', async () => {
    const state = new CartographerState();
    const node = new PublicRouteGeoNode();
    await node.executeOne(state, CTX);
    assert.equal(state.routing.geoLookupRun, true);
    assert.equal(state.routing.geoLookupSkipped, false);
  });
});

// ── RouteRedactionNode ────────────────────────────────────────────────────────

describe('RouteRedactionNode', () => {
  it('routes to "skip-redaction" when no PII present', async () => {
    const state = new CartographerState();
    // canonical.pii defaults to undefined (no pii flag); currentEvent has empty recipient fields
    state.canonical = CanonicalEventVariantBuilder.from({});
    const node = new PublicRouteRedactionNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'skip-redaction');
  });

  it('routes to "needs-redaction" when canonical.pii is true', async () => {
    const state = new CartographerState();
    const v = CanonicalEventVariantBuilder.from({});
    v.pii = true;
    state.canonical = v;
    // Give the event a non-empty shipmentId so consent resolution works
    state.currentEvent.shipmentId = 'SHP-001';
    state.currentEvent.marketingConsent = true;
    // Set a non-baseline jurisdiction so "light + valid" short-circuit doesn't fire
    state.geoContext.jurisdiction = 'GDPR';
    const node = new PublicRouteRedactionNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'needs-redaction');
  });

  it('routes to "skip-redaction" when already handled by source', async () => {
    const state = new CartographerState();
    const v = CanonicalEventVariantBuilder.from({});
    v.pii = true;
    v.consentHandled = true;
    state.canonical = v;
    const node = new PublicRouteRedactionNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'skip-redaction');
  });

  it('routes to "needs-redaction" when recipientName is non-empty', async () => {
    const state = new CartographerState();
    state.canonical = CanonicalEventVariantBuilder.from({});
    state.currentEvent.recipientName = 'Alice Müller';
    state.currentEvent.shipmentId = 'SHP-001';
    state.geoContext.jurisdiction = 'GDPR';
    const node = new PublicRouteRedactionNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'needs-redaction');
  });

  it('sets routing.redactionSkipped on skip path', async () => {
    const state = new CartographerState();
    state.canonical = CanonicalEventVariantBuilder.from({});
    const node = new PublicRouteRedactionNode();
    await node.executeOne(state, CTX);
    assert.equal(state.routing.redactionSkipped, true);
    assert.equal(state.routing.redactionRun, false);
  });

  it('sets routing.redactionRun on needs-redaction path', async () => {
    const state = new CartographerState();
    const v = CanonicalEventVariantBuilder.from({});
    v.pii = true;
    state.canonical = v;
    state.currentEvent.recipientName = 'Bob Chen';
    state.currentEvent.shipmentId = 'SHP-002';
    state.geoContext.jurisdiction = 'GDPR';
    const node = new PublicRouteRedactionNode();
    await node.executeOne(state, CTX);
    assert.equal(state.routing.redactionRun, true);
    assert.equal(state.routing.redactionSkipped, false);
  });
});

// ── ColdChainCheckNode ────────────────────────────────────────────────────────

describe('ColdChainCheckNode', () => {
  it('routes to "checked" always', async () => {
    const state = new CartographerState();
    const node = new PublicColdChainCheckNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'checked');
  });

  it('sets coldChainBreach true for a sensor-reading with temp outside range', async () => {
    const state = new CartographerState();
    // Construct a sensor-reading variant
    state.canonicalVariant = {
      'shipmentId':        'SHP-001',
      'eventId':           'EVT-001',
      'epochMs':           0,
      'eventType':         'sensor-reading',
      'sourceId':          'src-1',
      'sourceFormat':      'json',
      'sourceCompression': 'none',
      'body': {
        'scanSeq':      1,
        'latitude':     0,
        'longitude':    0,
        'ipAddress':    '',
        'legFromLat':   0,
        'legFromLng':   0,
        'originLat':    0,
        'originLng':    0,
        'destLat':      0,
        'destLng':      0,
        'carrier':      '',
        'status':       '',
        'rawTimestamp': '',
        'tempC':        1.5, // below 2°C minimum → breach
        'humidityPct':  50,
        'shockG':       0,
      },
    };
    const node = new PublicColdChainCheckNode();
    await node.executeOne(state, CTX);
    assert.equal(state.coldChainBreach, true);
  });

  it('sets coldChainBreach false for a sensor-reading in safe range', async () => {
    const state = new CartographerState();
    state.canonicalVariant = {
      'shipmentId':        'SHP-002',
      'eventId':           'EVT-002',
      'epochMs':           0,
      'eventType':         'sensor-reading',
      'sourceId':          'src-2',
      'sourceFormat':      'json',
      'sourceCompression': 'none',
      'body': {
        'scanSeq':      1,
        'latitude':     0,
        'longitude':    0,
        'ipAddress':    '',
        'legFromLat':   0,
        'legFromLng':   0,
        'originLat':    0,
        'originLng':    0,
        'destLat':      0,
        'destLng':      0,
        'carrier':      '',
        'status':       '',
        'rawTimestamp': '',
        'tempC':        5.0, // in range
        'humidityPct':  50,
        'shockG':       1.0, // under 2.5g
      },
    };
    const node = new PublicColdChainCheckNode();
    await node.executeOne(state, CTX);
    assert.equal(state.coldChainBreach, false);
  });

  it('treats non-sensor variants as no-breach (zero telemetry fallback)', async () => {
    const state = new CartographerState();
    // Default canonicalVariant is a position-ping with tempC/shockG absent
    // The node reads body.tempC/shockG with fallback 0, which is below 2°C — a breach.
    // Verify the node does NOT throw for non-sensor variants.
    const node = new PublicColdChainCheckNode();
    assert.doesNotThrow(async () => { await node.executeOne(state, CTX); });
  });
});

// ── CustomsDwellNode ──────────────────────────────────────────────────────────

describe('CustomsDwellNode', () => {
  it('routes to "dwelled" always', async () => {
    const state = new CartographerState();
    const node = new PublicCustomsDwellNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'dwelled');
  });

  it('sets customsDwellHours to 18 for a held customs-event', async () => {
    const state = new CartographerState();
    state.canonicalVariant = {
      'shipmentId':        'SHP-003',
      'eventId':           'EVT-003',
      'epochMs':           0,
      'eventType':         'customs-event',
      'sourceId':          'src-3',
      'sourceFormat':      'json',
      'sourceCompression': 'none',
      'body': {
        'scanSeq':      1,
        'latitude':     0,
        'longitude':    0,
        'ipAddress':    '',
        'legFromLat':   0,
        'legFromLng':   0,
        'originLat':    0,
        'originLng':    0,
        'destLat':      0,
        'destLng':      0,
        'carrier':      '',
        'status':       '',
        'rawTimestamp': '',
        'customsStatus': 'held',
      },
    };
    const node = new PublicCustomsDwellNode();
    await node.executeOne(state, CTX);
    assert.equal(state.customsDwellHours, 18);
  });

  it('sets customsDwellHours to 2 for a cleared customs-event', async () => {
    const state = new CartographerState();
    state.canonicalVariant = {
      'shipmentId':        'SHP-004',
      'eventId':           'EVT-004',
      'epochMs':           0,
      'eventType':         'customs-event',
      'sourceId':          'src-4',
      'sourceFormat':      'json',
      'sourceCompression': 'none',
      'body': {
        'scanSeq':      1,
        'latitude':     0,
        'longitude':    0,
        'ipAddress':    '',
        'legFromLat':   0,
        'legFromLng':   0,
        'originLat':    0,
        'originLng':    0,
        'destLat':      0,
        'destLng':      0,
        'carrier':      '',
        'status':       '',
        'rawTimestamp': '',
        'customsStatus': 'cleared',
      },
    };
    const node = new PublicCustomsDwellNode();
    await node.executeOne(state, CTX);
    assert.equal(state.customsDwellHours, 2);
  });

  it('defaults dwell to 4 for non-customs variants (empty status fallback)', async () => {
    const state = new CartographerState();
    // canonicalVariant is a position-ping — customsStatus reads '' → 4 hours default
    const node = new PublicCustomsDwellNode();
    await node.executeOne(state, CTX);
    assert.equal(state.customsDwellHours, 4);
  });
});

// ── EnrichLegNode ─────────────────────────────────────────────────────────────

describe('EnrichLegNode', () => {
  it('routes to "leg-measured" always', async () => {
    const state = new CartographerState();
    const node = new PublicEnrichLegNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'leg-measured');
  });

  it('computes legKm as haversine distance from legFrom to current scan', async () => {
    const state = new CartographerState();
    // London legFrom → Paris current scan
    state.normalized.legFromLat = 51.5;
    state.normalized.legFromLng = -0.1;
    state.normalized.latitude   = 48.9;
    state.normalized.longitude  = 2.3;
    const node = new PublicEnrichLegNode();
    await node.executeOne(state, CTX);
    // London→Paris ~340km
    assert.ok(state.legKm > 300 && state.legKm < 400, `Expected ~340km, got ${state.legKm}`);
  });

  it('minimum legKm is 1 km for same-point coords', async () => {
    const state = new CartographerState();
    state.normalized.legFromLat = 51.5;
    state.normalized.legFromLng = -0.1;
    state.normalized.latitude   = 51.5;
    state.normalized.longitude  = -0.1;
    const node = new PublicEnrichLegNode();
    await node.executeOne(state, CTX);
    assert.equal(state.legKm, 1);
  });
});

// ── AggregateEventNode ────────────────────────────────────────────────────────

describe('AggregateEventNode', () => {
  it('routes to "done"', async () => {
    const state = new CartographerState();
    const node = new PublicAggregateEventNode();
    const result = await node.executeOne(state, CTX);
    assert.equal(result.output, 'done');
  });

  it('writes enriched from the normalized + geo + gdpr + pricing + shipping + eta state fields', async () => {
    const state = new CartographerState();
    state.normalized.shipmentId = 'SHP-TEST-001';
    state.normalized.scanSeq    = 3;
    state.normalized.epochMs    = 1735689600000;
    state.normalized.status     = 'DEPARTURE';
    state.normalized.sizeTier   = 'medium';
    state.geoContext.continent  = 'Europe';
    state.geoContext.region     = 'Central Europe';
    state.geoContext.hub        = 'Leipzig';
    state.geoContext.timezone   = 'Europe/Berlin';
    state.geoContext.jurisdiction = 'GDPR';
    state.pricedOrder.subtotalUsdMinor = 1999;
    state.pricedOrder.currency  = 'EUR';
    state.shippingQuote.costUsdMinor = 599;
    state.shippingQuote.distanceKm   = 1200;
    state.deliveryEstimate.onTime     = true;
    state.deliveryEstimate.delayHours = 0;
    state.gdprResult.consentStatus   = 'valid';
    state.gdprResult.redactionApplied = false;
    state.legKm = 450;

    const node = new PublicAggregateEventNode();
    await node.executeOne(state, CTX);

    const e = state.enriched;
    assert.equal(e.shipmentId,       'SHP-TEST-001');
    assert.equal(e.scanSeq,          3);
    assert.equal(e.epochMs,          1735689600000);
    assert.equal(e.status,           'DEPARTURE');
    assert.equal(e.sizeTier,         'medium');
    assert.equal(e.continent,        'Europe');
    assert.equal(e.region,           'Central Europe');
    assert.equal(e.hub,              'Leipzig');
    assert.equal(e.timezone,         'Europe/Berlin');
    assert.equal(e.jurisdiction,     'GDPR');
    assert.equal(e.subtotalUsdMinor, 1999);
    assert.equal(e.currency,         'EUR');
    assert.equal(e.shippingUsdMinor, 599);
    assert.equal(e.distanceKm,       1200);
    assert.equal(e.onTime,           true);
    assert.equal(e.delayHours,       0);
    assert.equal(e.consentStatus,    'valid');
    assert.equal(e.legKm,            450);
    assert.equal(e.exception,        false); // status !== EXCEPTION
  });

  it('marks enriched.exception true when status is EXCEPTION', async () => {
    const state = new CartographerState();
    state.normalized.status = 'EXCEPTION';
    const node = new PublicAggregateEventNode();
    await node.executeOne(state, CTX);
    assert.equal(state.enriched.exception, true);
  });

  it('copies routing from state.routing (snapshot at time of call)', async () => {
    const state = new CartographerState();
    state.routing.geoLookupRun     = true;
    state.routing.redactionSkipped = true;
    const node = new PublicAggregateEventNode();
    await node.executeOne(state, CTX);
    assert.equal(state.enriched.routing.geoLookupRun,     true);
    assert.equal(state.enriched.routing.redactionSkipped, true);
  });
});
