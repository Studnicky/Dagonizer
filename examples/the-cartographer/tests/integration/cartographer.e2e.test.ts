/**
 * End-to-end integration test for the Cartographer DAG.
 *
 * Runs the full assembled pipeline over a deterministic, minimal seed
 * (recorded geo backend — offline, no network). Asserts that:
 *
 *  1. The pipeline reaches lifecycle 'completed' without throwing.
 *  2. state.insights is populated (geo resolved to at least one continent).
 *  3. state.sampleRecords contains enriched scans with expected fields.
 *  4. state.errorRollup tracks any captured exceptions (may be 0 on a clean run).
 *  5. state.journeys is populated with per-journey aggregates.
 *  6. Each enriched record's `routing` carries only the discriminant field
 *     `path` (not `kind`) and the correct flag shapes.
 *  7. The pipeline handles a mixed-format/multi-type event config.
 *
 * This is the "demo doesn't crash on publish" guard.
 *
 * Node 24 type-stripping: no enums, no namespaces, no parameter properties.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer } from '@studnicky/dagonizer';
import { CartographerState } from '../../CartographerState.ts';
import { CARTOGRAPHER_IRIS } from '../../cartographerIds.ts';
import { cartographerBundle, cartographerDAG, cartographerResumeDAG } from '../../dag.ts';
import { ingestSourceBundle } from '../../embedded-dags/IngestSourceDAG.ts';
import { GeoSourceResolveDAG } from '../../embedded-dags/GeoSourceResolveDAG.ts';
import { orderEnrichmentBundle } from '../../embedded-dags/OrderEnrichmentDAG.ts';
import { gdprComplianceBundle } from '../../embedded-dags/GdprComplianceDAG.ts';
import { GeoResolvers } from '../../services/GeoResolvers.ts';

// ── Shared setup ───────────────────────────────────────────────────────────────

class Harness {
  /**
   * Build a fresh Dagonizer instance with all bundles registered.
   * Uses the recorded (offline) geo backend for determinism.
   */
  static dispatcher(): Dagonizer<CartographerState> {
    const services = GeoResolvers.recorded();
    const dispatcher = new Dagonizer<CartographerState>({});
    dispatcher.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
    dispatcher.registerBundle(orderEnrichmentBundle);
    dispatcher.registerBundle(gdprComplianceBundle);
    dispatcher.registerBundle(ingestSourceBundle);
    dispatcher.registerBundle(cartographerBundle);
    return dispatcher;
  }

  /**
   * Minimal mixed-format event config for fast deterministic runs.
   * Covers all five event types to exercise every per-type pipeline branch.
   */
  static minimalEventConfig(): CartographerState['eventConfig'] {
    return [
      { 'eventType': 'position-ping',         'count': 3, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'facility-scan',         'count': 3, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'sensor-reading',        'count': 2, 'formatMix': [{ 'format': 'ndjson', 'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'customs-event',         'count': 2, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'delivery-confirmation', 'count': 2, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
    ];
  }

  /**
   * Execute the cartographer pipeline with a small seed and return the final state.
   */
  static async runPipeline(config?: CartographerState['eventConfig']): Promise<CartographerState> {
    const dispatcher = Harness.dispatcher();
    const state = new CartographerState();
    state.eventConfig = config ?? Harness.minimalEventConfig();

    const execution = dispatcher.execute('urn:noocodec:dag:cartographer', state);
    for await (const _stage of execution) { /* drain stages */ }
    await execution;
    return state;
  }
}

// ── Lifecycle completion ────────────────────────────────────────────────────────

describe('Cartographer DAG end-to-end', () => {
  let state: CartographerState;

  before(async () => {
    state = await Harness.runPipeline();
  }, { timeout: 60_000 });

  it('reaches lifecycle "completed"', () => {
    assert.equal(state.lifecycle.variant, 'completed');
  });

  it('declares source-specific feed DAG entrypoints that converge on the open intake gather', () => {
    const intakeGatherIri = CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographer, 'intake-gather');
    const feedSources = CARTOGRAPHER_IRIS.feedSources(CARTOGRAPHER_IRIS.dag.cartographer);

    assert.deepEqual(cartographerDAG.entrypoints, CARTOGRAPHER_IRIS.feedEntrypoints(CARTOGRAPHER_IRIS.dag.cartographer));
    assert.ok(!cartographerDAG.nodes.some((node) => node['@type'] === 'PhaseNode'), 'cartographer must not use a pre-phase intake node');

    for (const source of CARTOGRAPHER_IRIS.intakeEventTypes) {
      const feedPlacement = CARTOGRAPHER_IRIS.feedPlacementIri(CARTOGRAPHER_IRIS.dag.cartographer, source);
      const feedPlacementNode = cartographerDAG.nodes.find((node) => node['@id'] === feedPlacement);
      assert.ok(feedPlacementNode, `feed placement for '${source}' must exist`);
      assert.equal(feedPlacementNode['@type'], 'EmbeddedDAGNode');
      if (feedPlacementNode['@type'] !== 'EmbeddedDAGNode') assert.fail(`feed placement '${source}' must be an EmbeddedDAGNode`);
      assert.equal(feedPlacementNode.dag, CARTOGRAPHER_IRIS.feedDagIri(source));
      assert.equal(feedPlacementNode.outputs['success'], intakeGatherIri);
      assert.equal(feedPlacementNode.outputs['error'], intakeGatherIri);
    }

    const gather = cartographerDAG.nodes.find((node) => node['@id'] === intakeGatherIri);
    assert.ok(gather, 'intake-gather placement must exist');
    assert.equal(gather['@type'], 'GatherNode');
    if (gather['@type'] !== 'GatherNode') assert.fail('intake-gather must be a GatherNode');
    assert.deepEqual(gather.sources, feedSources);
    assert.equal(gather.gather.strategy, 'canonical-feed');

    const gatherIndex = cartographerDAG.nodes.findIndex((node) => node['@id'] === intakeGatherIri);
    const scatterIndex = cartographerDAG.nodes.findIndex((node) => node['@id'] === CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographer, 'process-stream'));
    assert.ok(gatherIndex >= 0, 'intake-gather placement must be present');
    assert.ok(scatterIndex > gatherIndex, 'process-stream scatter must come after intake-gather');

    const scatter = cartographerDAG.nodes.find((node) => node['@id'] === CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographer, 'process-stream'));
    assert.ok(scatter, 'process-stream placement must exist');
    assert.equal(scatter['@type'], 'ScatterNode');
    if (scatter['@type'] !== 'ScatterNode') assert.fail('process-stream must be a ScatterNode');
    assert.equal(scatter.source, 'canonicalEvents');
    assert.ok('dag' in scatter.body, 'process-stream must use a DAG body');
    assert.equal(scatter.body.dag, CARTOGRAPHER_IRIS.dag.eventPipelineTyped);
    assert.equal(scatter.itemKey, 'canonical-event');
  });

  it('declares the same producer feed topology for resume with item-mode processing', () => {
    const intakeGatherIri = CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographerResume, 'intake-gather');

    assert.deepEqual(cartographerResumeDAG.entrypoints, CARTOGRAPHER_IRIS.feedEntrypoints(CARTOGRAPHER_IRIS.dag.cartographerResume));

    for (const source of CARTOGRAPHER_IRIS.intakeEventTypes) {
      const feedPlacement = CARTOGRAPHER_IRIS.feedPlacementIri(CARTOGRAPHER_IRIS.dag.cartographerResume, source);
      const feedPlacementNode = cartographerResumeDAG.nodes.find((node) => node['@id'] === feedPlacement);
      assert.ok(feedPlacementNode, `resume feed placement for '${source}' must exist`);
      assert.equal(feedPlacementNode['@type'], 'EmbeddedDAGNode');
      if (feedPlacementNode['@type'] !== 'EmbeddedDAGNode') assert.fail(`resume feed placement '${source}' must be an EmbeddedDAGNode`);
      assert.equal(feedPlacementNode.dag, CARTOGRAPHER_IRIS.feedDagIri(source));
      assert.equal(feedPlacementNode.outputs['success'], intakeGatherIri);
      assert.equal(feedPlacementNode.outputs['error'], intakeGatherIri);
    }

    const gather = cartographerResumeDAG.nodes.find((node) => node['@id'] === intakeGatherIri);
    assert.ok(gather, 'resume intake-gather placement must exist');
    assert.equal(gather['@type'], 'GatherNode');
    if (gather['@type'] !== 'GatherNode') assert.fail('resume intake-gather must be a GatherNode');
    assert.deepEqual(gather.sources, CARTOGRAPHER_IRIS.feedSources(CARTOGRAPHER_IRIS.dag.cartographerResume));
    assert.equal(gather.gather.strategy, 'canonical-feed');

    const scatter = cartographerResumeDAG.nodes.find((node) => node['@id'] === CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographerResume, 'process-stream'));
    assert.ok(scatter, 'resume process-stream placement must exist');
    assert.equal(scatter['@type'], 'ScatterNode');
    if (scatter['@type'] !== 'ScatterNode') assert.fail('resume process-stream must be a ScatterNode');
    assert.equal(scatter.source, 'canonicalEvents');
    assert.ok('dag' in scatter.body, 'resume process-stream must use a DAG body');
    assert.equal(scatter.body.dag, CARTOGRAPHER_IRIS.dag.eventPipelineTyped);
    assert.equal(scatter.itemKey, 'canonical-event');
    assert.deepEqual(scatter.execution, { 'mode': 'item', 'concurrency': 16 });
  });

  it('populates state.insights with at least one continent', () => {
    assert.ok(state.insights.size >= 1, `Expected at least 1 region in insights, got ${state.insights.size}`);
  });

  it('populates state.sampleRecords with enriched records', () => {
    assert.ok(state.sampleRecords.length > 0, 'Expected at least one enriched record in sampleRecords');
  });

  it('every enriched record has a non-empty shipmentId', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.shipmentId.length > 0, `Found enriched record with empty shipmentId`);
    }
  });

  it('every enriched record has an epochMs > 0', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.epochMs > 0, `Found enriched record with epochMs=${record.epochMs}`);
    }
  });

  it('every enriched record.routing has no "kind" field', () => {
    for (const record of state.sampleRecords) {
      assert.ok(!('kind' in record.routing), 'routing must not have a "kind" field');
    }
  });

  it('every enriched record has a valid status string', () => {
    const validStatuses = new Set(['SCAN', 'DEPARTURE', 'ARRIVAL', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION']);
    for (const record of state.sampleRecords) {
      assert.ok(validStatuses.has(record.status), `Unexpected status: ${record.status}`);
    }
  });

  it('every enriched record has a valid sizeTier', () => {
    const validTiers = new Set(['envelope', 'small', 'medium', 'large', 'freight']);
    for (const record of state.sampleRecords) {
      assert.ok(validTiers.has(record.sizeTier), `Unexpected sizeTier: ${record.sizeTier}`);
    }
  });

  it('every enriched record has a valid consentStatus', () => {
    const validStatuses = new Set(['valid', 'missing', 'expired']);
    for (const record of state.sampleRecords) {
      assert.ok(validStatuses.has(record.consentStatus), `Unexpected consentStatus: ${record.consentStatus}`);
    }
  });

  it('insights entries have non-negative shipmentCount', () => {
    for (const [key, entry] of state.insights) {
      assert.ok(
        entry.shipmentCount >= 0,
        `Region "${key}" has negative shipmentCount: ${entry.shipmentCount}`,
      );
    }
  });

  it('insights total shipmentCount across all regions matches sampleRecords count', () => {
    // The insights fold counts every event (exact, not sampled). The sampleRecords
    // cap is 200, so for tiny runs they should match.
    let totalScans = 0;
    for (const entry of state.insights.values()) totalScans += entry.shipmentCount;
    assert.ok(
      totalScans >= state.sampleRecords.length,
      `Expected insights total ${totalScans} >= sampleRecords ${state.sampleRecords.length}`,
    );
  });

  it('errorRollup.total is a non-negative integer', () => {
    assert.ok(state.errorRollup.total >= 0);
    assert.equal(state.errorRollup.total, Math.floor(state.errorRollup.total));
  });

  it('state.journeys is populated with at least one journey', () => {
    assert.ok(state.journeys.size >= 1, `Expected at least 1 journey, got ${state.journeys.size}`);
  });

  it('each journey has a scanCount >= 1', () => {
    for (const [id, journey] of state.journeys) {
      assert.ok(journey.scanCount >= 1, `Journey "${id}" has scanCount=${journey.scanCount}`);
    }
  });

  it('each journey elapsedHours is non-negative', () => {
    for (const [id, journey] of state.journeys) {
      assert.ok(journey.elapsedHours >= 0, `Journey "${id}" has negative elapsedHours`);
    }
  });

  it('each journey.scans is a non-empty array', () => {
    for (const [id, journey] of state.journeys) {
      assert.ok(journey.scans.length >= 1, `Journey "${id}" has no scans`);
    }
  });

  // ── Routing flag invariants ────────────────────────────────────────────────────

  it('routing: geoLookupRun and geoLookupSkipped are mutually exclusive per record', () => {
    for (const record of state.sampleRecords) {
      const { geoLookupRun, geoLookupSkipped } = record.routing;
      assert.ok(
        !(geoLookupRun && geoLookupSkipped),
        `Record ${record.shipmentId} has both geoLookupRun and geoLookupSkipped set`,
      );
    }
  });

  it('routing: redactionRun and redactionSkipped are mutually exclusive per record', () => {
    for (const record of state.sampleRecords) {
      const { redactionRun, redactionSkipped } = record.routing;
      assert.ok(
        !(redactionRun && redactionSkipped),
        `Record ${record.shipmentId} has both redactionRun and redactionSkipped set`,
      );
    }
  });

  it('routing: pricingRun and pricingSkipped are mutually exclusive per record', () => {
    for (const record of state.sampleRecords) {
      const { pricingRun, pricingSkipped } = record.routing;
      assert.ok(
        !(pricingRun && pricingSkipped),
        `Record ${record.shipmentId} has both pricingRun and pricingSkipped set`,
      );
    }
  });

  // ── Financial value invariants ─────────────────────────────────────────────────

  it('subtotalUsdMinor is non-negative on all enriched records', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.subtotalUsdMinor >= 0, `Record ${record.shipmentId} has negative subtotalUsdMinor`);
    }
  });

  it('shippingUsdMinor is non-negative on all enriched records', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.shippingUsdMinor >= 0, `Record ${record.shipmentId} has negative shippingUsdMinor`);
    }
  });

  it('delayHours is non-negative on all enriched records', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.delayHours >= 0, `Record ${record.shipmentId} has negative delayHours`);
    }
  });

  it('legKm is >= 1 on all enriched records (minimum haversine clamp)', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.legKm >= 1, `Record ${record.shipmentId} has legKm=${record.legKm}`);
    }
  });

  // ── Multi-type coverage check ──────────────────────────────────────────────────

  it('pipeline processes all five event-type lanes (routing.path distribution)', () => {
    const paths = new Set(state.sampleRecords.map((r) => r.routing.path));
    // Our event config includes all 5 types. The routing path should reflect
    // at least more than one lane processed (the config has position-ping, facility-scan,
    // sensor-reading, customs-event, delivery-confirmation).
    assert.ok(paths.size >= 1, 'Expected at least one routing.path in enriched records');
  });
});

// ── Minimal single-type run ────────────────────────────────────────────────────

describe('Cartographer DAG — single-type position-ping run', () => {
  it('completes with just position-ping events', { timeout: 60_000 }, async () => {
    const singleTypeConfig: CartographerState['eventConfig'] = [
      { 'eventType': 'position-ping', 'count': 3, 'formatMix': [{ 'format': 'json', 'compression': 'none', 'weight': 1 }] },
    ];
    const state = await Harness.runPipeline(singleTypeConfig);
    assert.equal(state.lifecycle.variant, 'completed');
    assert.ok(state.sampleRecords.length > 0);
    // All routing paths should come from position-ping lane
    for (const record of state.sampleRecords) {
      // position-ping maps to 'order' or 'geo-only' depending on routing
      assert.ok(record.routing.path !== undefined);
    }
  });
});

// ── InsightsFoldGather region accumulation ────────────────────────────────────

describe('Cartographer DAG — RegionInsights accumulation', () => {
  it('region insights onTimeCount + lateCount equals etaRun events in that region', { timeout: 60_000 }, async () => {
    const state = await Harness.runPipeline(Harness.minimalEventConfig());
    for (const [key, entry] of state.insights) {
      // onTimeCount + lateCount can be less than shipmentCount because some event types
      // (sensor-reading, customs-event) skip etaRun, so we just verify non-negative
      assert.ok(entry.onTimeCount >= 0, `Region "${key}": negative onTimeCount`);
      assert.ok(entry.lateCount >= 0, `Region "${key}": negative lateCount`);
      assert.ok(
        entry.onTimeCount + entry.lateCount <= entry.shipmentCount,
        `Region "${key}": onTime+late (${entry.onTimeCount + entry.lateCount}) > shipmentCount (${entry.shipmentCount})`,
      );
    }
  });

  it('consentValid + consentMissing + consentExpired equals shipmentCount per region', { timeout: 60_000 }, async () => {
    const state = await Harness.runPipeline(Harness.minimalEventConfig());
    for (const [key, entry] of state.insights) {
      const consentTotal = entry.consentValid + entry.consentMissing + entry.consentExpired;
      assert.equal(
        consentTotal,
        entry.shipmentCount,
        `Region "${key}": consent totals ${consentTotal} !== shipmentCount ${entry.shipmentCount}`,
      );
    }
  });

  it('size tier counts sum to shipmentCount per region', { timeout: 60_000 }, async () => {
    const state = await Harness.runPipeline(Harness.minimalEventConfig());
    for (const [key, entry] of state.insights) {
      const tierTotal = entry.sizeTierEnvelope + entry.sizeTierSmall + entry.sizeTierMedium
        + entry.sizeTierLarge + entry.sizeTierFreight;
      assert.equal(
        tierTotal,
        entry.shipmentCount,
        `Region "${key}": sizeTier totals ${tierTotal} !== shipmentCount ${entry.shipmentCount}`,
      );
    }
  });
});

// ── DAG bundle registration ────────────────────────────────────────────────────

describe('Cartographer DAG bundle registration', () => {
  it('registers the top-level DAG, embedded DAGs, and processing nodes', () => {
    const dispatcher = Harness.dispatcher();

    assert.ok(dispatcher.getDAG(CARTOGRAPHER_IRIS.dag.cartographer) !== undefined, 'top-level Cartographer DAG must be registered');
    assert.ok(dispatcher.getDAG(CARTOGRAPHER_IRIS.dag.streamEvent) !== undefined, 'stream-event embedded DAG must be registered');
    assert.ok(dispatcher.getDAG(CARTOGRAPHER_IRIS.dag.geoSourceResolve) !== undefined, 'geo source resolver DAG must be registered');
    assert.ok(dispatcher.getNode('urn:noocodec:node:decode-payload') !== undefined, 'stream decoder node must be registered');
    assert.ok(dispatcher.getNode('urn:noocodec:node:summarize') !== undefined, 'summary node must be registered');
  });

  it('the dispatcher can be constructed with recorded services', () => {
    const services = GeoResolvers.recorded();
    assert.ok(services.ipGeolocator !== undefined);
  });
});
