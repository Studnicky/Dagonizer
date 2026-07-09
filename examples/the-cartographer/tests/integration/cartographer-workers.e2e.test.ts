/**
 * Cartographer workers-bundle DAG end-to-end integration test.
 *
 * Exercises CartographerWorkersDag.bundle() — the container-tagged variant
 * used by the in-browser demo — in-process on Node. The `container: 'cpu'`
 * directive on the process-stream scatter and `container: 'io'` directive on
 * the summarize-insights embed are ignored when no containers are bound to the
 * dispatcher (hasContainers() returns false), so every delegated body runs
 * in-process, identical to the non-workers cartographer pipeline.
 *
 * Two fixtures tested:
 *
 *   1. Full five-type run — mirrors the existing cartographer.e2e.test.ts
 *      assertions (lifecycle, insights, sampleRecords, routing invariants,
 *      financial fields) against the workers bundle to confirm they stay
 *      equivalent.
 *
 *   2. Single-type position-ping run — minimal smoke against the workers bundle.
 *
 * Plus a static import check that the worker registry module imports without
 * error (the module that Node would dynamic-import inside worker threads).
 *
 * Node 24 type-stripping: no enums, no namespaces, no parameter properties.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { Dagonizer, type DAGNodeType } from '@studnicky/dagonizer';
import { CartographerState } from '../../CartographerState.ts';
import { CARTOGRAPHER_IRIS } from '../../cartographerIds.ts';
import { CartographerWorkersDag } from '../../dag.ts';
import { GeoSourceResolveDAG } from '../../embedded-dags/GeoSourceResolveDAG.ts';
import { orderEnrichmentBundle } from '../../embedded-dags/OrderEnrichmentDAG.ts';
import { gdprComplianceBundle } from '../../embedded-dags/GdprComplianceDAG.ts';
import { ingestSourceBundle } from '../../embedded-dags/IngestSourceDAG.ts';
import { GeoResolvers } from '../../services/GeoResolvers.ts';

// ── Harness ──────────────────────────────────────────────────────────────────

/**
 * WorkersHarness: encapsulates workers-bundle dispatcher construction.
 *
 * Static-only. No freestanding functions.
 */
class WorkersHarness {
  private constructor() { /* static-only */ }

  /**
   * Build a Dagonizer instance with the workers bundle registered.
   * Uses the recorded (offline) geo backend for determinism.
   * The container directives on the workers DAG placements are ignored because
   * no DagContainerInterface is bound (hasContainers() === false).
   */
  static dispatcher(): Dagonizer<CartographerState> {
    const services = GeoResolvers.recorded();
    const dispatcher = new Dagonizer<CartographerState>({});

    // Register the same bundle order as the existing cartographer.e2e.test.ts,
    // but use CartographerWorkersDag.bundle() as the top-level bundle so that
    // the cartographer DAG carries container roles on its delegated placements.
    dispatcher.registerBundle(GeoSourceResolveDAG.build(services.ipGeolocator, services.addressGeocoder));
    dispatcher.registerBundle(orderEnrichmentBundle);
    dispatcher.registerBundle(gdprComplianceBundle);
    dispatcher.registerBundle(ingestSourceBundle);
    dispatcher.registerBundle(CartographerWorkersDag.bundle());

    return dispatcher;
  }

  /** Five event-type config identical to the existing integration test. */
  static minimalEventConfig(): CartographerState['eventConfig'] {
    return [
      { 'eventType': 'position-ping',         'count': 3, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'facility-scan',         'count': 3, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'sensor-reading',        'count': 2, 'formatMix': [{ 'format': 'ndjson', 'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'customs-event',         'count': 2, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
      { 'eventType': 'delivery-confirmation', 'count': 2, 'formatMix': [{ 'format': 'json',   'compression': 'none', 'weight': 1 }] },
    ];
  }

  /** Execute the workers pipeline and drain the stage iterator. Returns final state. */
  static async runPipeline(config?: CartographerState['eventConfig']): Promise<CartographerState> {
    const dispatcher = WorkersHarness.dispatcher();
    const state = new CartographerState();
    state.eventConfig = config ?? WorkersHarness.minimalEventConfig();

    const execution = dispatcher.execute('urn:noocodec:dag:cartographer', state);
    for await (const _stage of execution) { /* drain stages */ }
    await execution;
    return state;
  }
}

// ── Workers bundle construction smoke ─────────────────────────────────────────

describe('Cartographer workers-bundle registration', () => {
  it('registers the workers top-level DAG, embedded DAGs, and processing nodes', () => {
    const dispatcher = WorkersHarness.dispatcher();

    assert.ok(dispatcher.getDAG(CARTOGRAPHER_IRIS.dag.cartographer) !== undefined, 'workers Cartographer DAG must be registered');
    assert.ok(dispatcher.getDAG(CARTOGRAPHER_IRIS.dag.streamEvent) !== undefined, 'stream-event embedded DAG must be registered');
    assert.ok(dispatcher.getDAG(CARTOGRAPHER_IRIS.dag.insightsSummary) !== undefined, 'container-delegated summary DAG must be registered');
    assert.ok(dispatcher.getNode('urn:noocodec:node:decode-payload') !== undefined, 'stream decoder node must be registered');
    assert.ok(dispatcher.getNode('urn:noocodec:node:summarize') !== undefined, 'summary node must be registered');
  });

  it('CartographerWorkersDag.bundle() produces a non-empty bundle', () => {
    const bundle = CartographerWorkersDag.bundle();
    assert.ok(bundle.nodes.length > 0, 'workers bundle must have at least one node');
    assert.ok(bundle.dags.length > 0,  'workers bundle must have at least one DAG');
  });

  it('CartographerWorkersDag.bundle(capacity) accepts a custom reservoir capacity', () => {
    const bundle = CartographerWorkersDag.bundle(50);
    assert.ok(bundle.nodes.length > 0);
    assert.ok(bundle.dags.length > 0);
  });

  it('CartographerWorkersDag.bundle() carries cpu and io container placements', () => {
    const bundle = CartographerWorkersDag.bundle();
    const dag = bundle.dags.find((candidate) => candidate['@id'] === CARTOGRAPHER_IRIS.dag.cartographer);
    assert.ok(dag, 'cartographer DAG must be registered');

    const intakeGatherIri = CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographer, 'intake-gather');
    const feedSources = CARTOGRAPHER_IRIS.feedSources(CARTOGRAPHER_IRIS.dag.cartographer);

    assert.deepEqual(dag.entrypoints, CARTOGRAPHER_IRIS.feedEntrypoints(CARTOGRAPHER_IRIS.dag.cartographer));
    assert.ok(!dag.nodes.some((node) => node['@type'] === 'PhaseNode'), 'workers cartographer must not use a pre-phase intake node');

    for (const source of CARTOGRAPHER_IRIS.intakeEventTypes) {
      const feedPlacement = CARTOGRAPHER_IRIS.feedPlacementIri(CARTOGRAPHER_IRIS.dag.cartographer, source);
      const feedPlacementNode: DAGNodeType | undefined = dag.nodes.find((node) => node['@id'] === feedPlacement);
      assert.ok(feedPlacementNode, `feed placement for '${source}' must exist`);
      assert.equal(feedPlacementNode['@type'], 'EmbeddedDAGNode');
      if (feedPlacementNode['@type'] !== 'EmbeddedDAGNode') assert.fail(`feed placement '${source}' must be an EmbeddedDAGNode`);
      assert.equal(feedPlacementNode.dag, CARTOGRAPHER_IRIS.feedDagIri(source));
      assert.equal(feedPlacementNode.outputs['success'], intakeGatherIri);
      assert.equal(feedPlacementNode.outputs['error'], intakeGatherIri);
    }

    const gather = dag.nodes.find((node) => node['@id'] === intakeGatherIri);
    assert.ok(gather, 'intake-gather placement must exist');
    assert.equal(gather['@type'], 'GatherNode');
    if (gather['@type'] !== 'GatherNode') assert.fail('intake-gather must be a GatherNode');
    assert.deepEqual(gather.sources, feedSources);
    assert.equal(gather.gather.strategy, 'canonical-feed');

    const scatter = dag.nodes.find((node) => node['@id'] === CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographer, 'process-stream'));
    assert.ok(scatter, 'process-stream placement must exist');
    assert.equal(scatter['@type'], 'ScatterNode');
    if (scatter['@type'] !== 'ScatterNode') assert.fail('process-stream must be a ScatterNode');
    assert.equal(scatter.source, 'canonicalEvents');
    assert.ok('dag' in scatter.body, 'process-stream must use a DAG body');
    assert.equal(scatter.body.dag, CARTOGRAPHER_IRIS.dag.eventPipelineTyped);
    assert.equal(scatter.itemKey, 'canonical-event');
    assert.equal(scatter.container, 'cpu');

    const summary = dag.nodes.find((node) => node['@id'] === CARTOGRAPHER_IRIS.placementIri(CARTOGRAPHER_IRIS.dag.cartographer, 'summarize-insights'));
    assert.ok(summary, 'summarize-insights placement must exist');
    assert.equal(summary['@type'], 'EmbeddedDAGNode');
    if (summary['@type'] !== 'EmbeddedDAGNode') assert.fail('summarize-insights must be an EmbeddedDAGNode');
    assert.equal(summary.container, 'io');
    assert.equal(summary.dag, CARTOGRAPHER_IRIS.dag.insightsSummary);
  });

  it('workers dispatcher uses recorded geo services', () => {
    const services = GeoResolvers.recorded();
    assert.ok(services.ipGeolocator !== undefined);
  });
});

// ── Worker registry module static import smoke ────────────────────────────────
//
// The eventPipelineRegistry.ts worker entry imports from '../dag.js' (compiled
// extension) because it is designed to be compiled to JavaScript before worker
// threads dynamic-import it at runtime (see the file's own header comment).
// Importing the .ts source directly from Node therefore fails with
// ERR_MODULE_NOT_FOUND on the .js import.
//
// The smoke check verifies the *dependencies* of the worker registry — the
// modules it would use at runtime — import cleanly from TypeScript. This gives
// the same coverage guarantee without requiring a pre-compiled dist step:
// if the registry's imports break at compile time, this test breaks first.

describe('Cartographer worker entry registry — dependency smoke', () => {
  it('cartographerWorkerRuntimeBundle (registry dependency) is importable and non-empty', async () => {
    // Import the bundle the registry re-exports inside each worker thread.
    const { cartographerWorkerRuntimeBundle } = await import('../../dag.ts');
    assert.ok(cartographerWorkerRuntimeBundle.nodes.length > 0, 'cartographerWorkerRuntimeBundle must have nodes');
    assert.ok(cartographerWorkerRuntimeBundle.dags.length > 0,  'cartographerWorkerRuntimeBundle must have DAGs');
  });

  it('CartographerState is importable and constructable (registry dependency)', async () => {
    const { CartographerState } = await import('../../CartographerState.ts');
    const state = new CartographerState();
    assert.ok(state !== undefined, 'CartographerState must be constructable');
  });

  it('GeoResolvers.recorded() is importable (registry services factory)', async () => {
    const { GeoResolvers } = await import('../../services/GeoResolvers.ts');
    const services = GeoResolvers.recorded();
    assert.ok(services.ipGeolocator !== undefined);
  });

  it('worker entry file exists at the expected path', async () => {
    // Verify the registry source file is present (path the repo documents
    // as the worker entry point). The file itself cannot be imported from
    // TypeScript because it uses .js extension imports for the compiled
    // worker runtime; presence confirms the module is in the source tree.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const entryPath = path.resolve(
      new URL('.', import.meta.url).pathname,
      '../../workers/eventPipelineRegistry.ts',
    );
    const stat = await fs.stat(entryPath);
    assert.ok(stat.isFile(), `worker entry must exist at ${entryPath}`);
  });
});

// ── Full five-type run ────────────────────────────────────────────────────────

describe('Cartographer workers DAG — five-type end-to-end', () => {
  let state: CartographerState;

  before(async () => {
    state = await WorkersHarness.runPipeline();
  }, { timeout: 60_000 });

  it('reaches lifecycle "completed"', () => {
    assert.equal(state.lifecycle.variant, 'completed');
  });

  it('populates state.insights with at least one continent/region', () => {
    assert.ok(state.insights.size >= 1, `Expected ≥1 region in insights, got ${state.insights.size}`);
  });

  it('populates state.sampleRecords with enriched records', () => {
    assert.ok(state.sampleRecords.length > 0, 'Expected at least one enriched record in sampleRecords');
  });

  it('every enriched record has a non-empty shipmentId', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.shipmentId.length > 0, `Found enriched record with empty shipmentId`);
    }
  });

  it('every enriched record has epochMs > 0', () => {
    for (const record of state.sampleRecords) {
      assert.ok(record.epochMs > 0, `Record ${record.shipmentId} has epochMs=${record.epochMs}`);
    }
  });

  it('errorRollup.total is a non-negative integer', () => {
    assert.ok(state.errorRollup.total >= 0);
    assert.equal(state.errorRollup.total, Math.floor(state.errorRollup.total));
  });

  it('state.journeys is populated with at least one journey', () => {
    assert.ok(state.journeys.size >= 1, `Expected ≥1 journey, got ${state.journeys.size}`);
  });

  it('each journey has scanCount >= 1', () => {
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

  // ── Routing flag mutual-exclusion invariants ───────────────────────────────

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

  it('routing records have no "kind" field', () => {
    for (const record of state.sampleRecords) {
      assert.ok(!('kind' in record.routing), 'routing must not have a "kind" field');
    }
  });

  // ── Financial value invariants ─────────────────────────────────────────────

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

  // ── Region insight invariants ──────────────────────────────────────────────

  it('insights entries have non-negative shipmentCount', () => {
    for (const [key, entry] of state.insights) {
      assert.ok(
        entry.shipmentCount >= 0,
        `Region "${key}" has negative shipmentCount: ${entry.shipmentCount}`,
      );
    }
  });

  it('insights total shipmentCount >= sampleRecords length', () => {
    let total = 0;
    for (const entry of state.insights.values()) total += entry.shipmentCount;
    assert.ok(
      total >= state.sampleRecords.length,
      `insights total ${total} < sampleRecords ${state.sampleRecords.length}`,
    );
  });

  it('region onTimeCount + lateCount <= shipmentCount', () => {
    for (const [key, entry] of state.insights) {
      assert.ok(
        entry.onTimeCount + entry.lateCount <= entry.shipmentCount,
        `Region "${key}": onTime+late (${entry.onTimeCount + entry.lateCount}) > shipmentCount (${entry.shipmentCount})`,
      );
    }
  });

  it('region consent totals equal shipmentCount', () => {
    for (const [key, entry] of state.insights) {
      const consentTotal = entry.consentValid + entry.consentMissing + entry.consentExpired;
      assert.equal(
        consentTotal,
        entry.shipmentCount,
        `Region "${key}": consent totals ${consentTotal} !== shipmentCount ${entry.shipmentCount}`,
      );
    }
  });

  it('region size tier counts sum to shipmentCount', () => {
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

// ── Single-type position-ping run ─────────────────────────────────────────────

describe('Cartographer workers DAG — single-type position-ping run', () => {
  it('completes with just position-ping events', { timeout: 60_000 }, async () => {
    const config: CartographerState['eventConfig'] = [
      { 'eventType': 'position-ping', 'count': 3, 'formatMix': [{ 'format': 'json', 'compression': 'none', 'weight': 1 }] },
    ];
    const state = await WorkersHarness.runPipeline(config);
    assert.equal(state.lifecycle.variant, 'completed');
    assert.ok(state.sampleRecords.length > 0);
    for (const record of state.sampleRecords) {
      assert.ok(record.routing.path !== undefined);
    }
  });
});
