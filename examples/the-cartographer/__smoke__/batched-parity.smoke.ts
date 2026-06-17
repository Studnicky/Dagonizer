/**
 * batched-parity.smoke.ts: parity smoke for the batch vs per-event pipeline paths.
 *
 * Runs the same position-ping-only EventTypeConfig through TWO independent
 * dispatchers using GeoResolvers.recorded() (deterministic, offline):
 *
 *   (A) Per-event path: sources = streamTyped (SourcePayload[])
 *       scatter itemKey 'source-payload', body 'stream-event',
 *       gather 'insights-fold'
 *
 *   (B) Batch path: sources = streamTypedBatches (SourcePayload[][])
 *       scatter itemKey 'source-batch', body 'stream-event-batch',
 *       gather 'insights-fold-batch'
 *
 * Assert: both produce the SAME set of region insight keys, the SAME total
 * shipmentCount sum, and the SAME per-region shipmentCount (region rollup is exact
 * in both gather strategies). Bounded-sample fields (journeys, sampleRecords) may
 * differ because ordering across concurrent scatter clones is non-deterministic, so
 * we assert only exact/deterministic fields: region keys and shipmentCount per region.
 *
 * Run: npx tsx examples/the-cartographer/__smoke__/batched-parity.smoke.ts
 */

import { strict as assert } from 'node:assert';

import { CartographerState }     from '../CartographerState.ts';
import type { CartographerServices } from '../CartographerServices.ts';
import type { EventTypeConfig }       from '../services.ts';
import { eventPipelineBundle }   from '../dag.ts';
import { ingestSourceBundle }    from '../embedded-dags/IngestSourceDAG.ts';
import { streamEventBatchBundle } from '../embedded-dags/StreamEventBatchDAG.ts';
import { GeoResolvers }          from '../services/GeoResolvers.ts';
import { EventStreamSource }     from '../services/EventStreamSource.ts';

import { Dagonizer, DAGBuilder }      from '@noocodex/dagonizer';
import type { DispatcherBundle } from '@noocodex/dagonizer';
import { seedEvents }            from '../nodes/seedEvents.ts';
import { summarizeInsights }     from '../nodes/summarizeInsights.ts';

import './../../the-cartographer/core/InsightsFoldGatherBatch.ts';
import { NodeOutputBuilder, type NodeContextInterface, type NodeOutputInterface, ScalarNode } from '@noocodex/dagonizer';

// ── Batch seed node (smoke-only; sets state.sources to batch iterable) ───────

class SeedBatchEventsNode extends ScalarNode<CartographerState, never, CartographerServices> {
  readonly 'name' = 'seed-batch-events';
  readonly 'outputs' = [] as const;

  protected override async executeOne(state: CartographerState, _context: NodeContextInterface<CartographerServices>): Promise<NodeOutputInterface<never>> {
    const count = state.streamCount > 0 ? state.streamCount : undefined;
    state.sources = EventStreamSource.streamTypedBatches(state.eventConfig, count);
    return NodeOutputBuilder.of(undefined as never);
  }
}

const seedBatchEvents = new SeedBatchEventsNode();

// ── Config ────────────────────────────────────────────────────────────────────

// Position-ping only: keeps the test fast and targets the implemented batch path.
// 2000 events → ~2 batches of ~1000 (depending on config count × formatMix).
const POSITION_PING_CONFIG: EventTypeConfig = [
  {
    'eventType': 'position-ping',
    'count':     6,
    'formatMix': [
      { 'format': 'json', 'compression': 'none', 'weight': 2 },
      { 'format': 'yaml', 'compression': 'gzip', 'weight': 1 },
    ],
  },
];

// eventCount drives the ShipmentEvents generator seed.
const EVENT_COUNT = 2000;

let failures = 0;

function pass(name: string): void {
  console.log(`PASS  ${name}`);
}

function fail(name: string, err: unknown): void {
  failures++;
  console.error(`FAIL  ${name}`);
  console.error(`      ${err instanceof Error ? err.message : String(err)}`);
}

// ── Per-event dispatcher (path A) ─────────────────────────────────────────────

async function runPerEvent(): Promise<CartographerState> {
  const services: CartographerServices = GeoResolvers.recorded();
  const dispatcher = new Dagonizer<CartographerState, CartographerServices>({ 'services': services });
  dispatcher.registerBundle(eventPipelineBundle);
  dispatcher.registerBundle(ingestSourceBundle);

  // Build a per-event cartographer DAG inline (same topology as cartographerDAG
  // in dag.ts, but built fresh so this file does not import the production dag
  // and risk registration side-effects from the batch bundle).
  const perEventDAG = new DAGBuilder('cartographer-parity-per-event', '1.0')
    .phase('seed', 'pre', seedEvents)
    .scatter(
      'process-stream',
      'sources',
      { 'dag': 'stream-event' },
      {
        'all-success': 'summarize',
        'partial':     'summarize',
        'all-error':   'summarize',
        'empty':       'summarize',
      },
      {
        'itemKey':     'source-payload',
        'concurrency': 16,
        'gather': { 'strategy': 'insights-fold' },
      },
    )
    .node('summarize', summarizeInsights, { 'success': 'done' })
    .terminal('done', { outcome: 'completed' })
    .build();

  const perEventBundle: DispatcherBundle<CartographerState, CartographerServices> = {
    'nodes': [seedEvents, summarizeInsights],
    'dags':  [perEventDAG],
  };
  dispatcher.registerBundle(perEventBundle);

  const state = new CartographerState();
  state.eventCount      = EVENT_COUNT;
  state.eventConfig     = POSITION_PING_CONFIG;
  state.useStreamingSource = true;
  state.streamCount     = EVENT_COUNT;

  const execution = dispatcher.execute('cartographer-parity-per-event', state);
  for await (const _stage of execution) { /* drain */ }
  await execution;
  return state;
}

// ── Batch dispatcher (path B) ─────────────────────────────────────────────────

async function runBatch(): Promise<CartographerState> {
  const services: CartographerServices = GeoResolvers.recorded();
  const dispatcher = new Dagonizer<CartographerState, CartographerServices>({ 'services': services });
  dispatcher.registerBundle(eventPipelineBundle);
  dispatcher.registerBundle(ingestSourceBundle);
  dispatcher.registerBundle(streamEventBatchBundle);

  // A batch cartographer DAG: sources is an AsyncIterable<SourcePayload[]> from
  // EventStreamSource.streamTypedBatches; scatter uses itemKey 'source-batch' and
  // body 'stream-event-batch'; gather is 'insights-fold-batch'.
  const batchDAG = new DAGBuilder('cartographer-parity-batch', '1.0')
    .phase('seed', 'pre', seedBatchEvents)
    .scatter(
      'process-stream',
      'sources',
      { 'dag': 'stream-event-batch' },
      {
        'all-success': 'summarize',
        'partial':     'summarize',
        'all-error':   'summarize',
        'empty':       'summarize',
      },
      {
        'itemKey':     'source-batch',
        'concurrency': 16,
        'gather': { 'strategy': 'insights-fold-batch' },
      },
    )
    .node('summarize', summarizeInsights, { 'success': 'done' })
    .terminal('done', { outcome: 'completed' })
    .build();

  const batchBundle: DispatcherBundle<CartographerState, CartographerServices> = {
    'nodes': [seedBatchEvents, summarizeInsights],
    'dags':  [batchDAG],
  };
  dispatcher.registerBundle(batchBundle);

  const state = new CartographerState();
  state.eventCount      = EVENT_COUNT;
  state.eventConfig     = POSITION_PING_CONFIG;
  state.streamCount     = EVENT_COUNT;

  const execution = dispatcher.execute('cartographer-parity-batch', state);
  for await (const _stage of execution) { /* drain */ }
  await execution;
  return state;
}

// ── Region table printer ──────────────────────────────────────────────────────

function printTable(label: string, state: CartographerState): void {
  console.log(`\n  ${label} — ${state.insights.size} region(s):`);
  const sorted = [...state.insights.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (sorted.length === 0) {
    console.log('    (empty)');
    return;
  }
  // Header
  console.log(`    ${'Region'.padEnd(40)} ${'shipmentCount'.padStart(14)}`);
  console.log(`    ${'-'.repeat(40)} ${'-'.repeat(14)}`);
  for (const [key, region] of sorted) {
    console.log(`    ${key.padEnd(40)} ${String(region.shipmentCount).padStart(14)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nParity smoke: position-ping, eventCount=${EVENT_COUNT}`);
console.log('Running per-event path (A)...');
const perEventState = await runPerEvent();
console.log('Running batch path (B)...');
const batchState = await runBatch();

printTable('Path A — per-event', perEventState);
printTable('Path B — batch', batchState);

const perEventTotal = [...perEventState.insights.values()].reduce((s, r) => s + r.shipmentCount, 0);
const batchTotal    = [...batchState.insights.values()].reduce((s, r) => s + r.shipmentCount, 0);
console.log(`\n  Per-event total shipmentCount: ${perEventTotal}`);
console.log(`  Batch total shipmentCount:     ${batchTotal}`);

// ── Assertions ────────────────────────────────────────────────────────────────

try {
  assert.ok(perEventState.insights.size > 0, 'Per-event path produced no region insights');
  pass('per-event path produced insights');
} catch (e) { fail('per-event path produced insights', e); }

try {
  assert.ok(batchState.insights.size > 0, 'Batch path produced no region insights');
  pass('batch path produced insights');
} catch (e) { fail('batch path produced insights', e); }

// Same set of region keys
try {
  const perEventKeys = new Set(perEventState.insights.keys());
  const batchKeys    = new Set(batchState.insights.keys());
  const inPerEventNotBatch = [...perEventKeys].filter((k) => !batchKeys.has(k));
  const inBatchNotPerEvent = [...batchKeys].filter((k) => !perEventKeys.has(k));
  assert.ok(
    inPerEventNotBatch.length === 0 && inBatchNotPerEvent.length === 0,
    `Region key mismatch.\n  In per-event but not batch: [${inPerEventNotBatch.join(', ')}]\n  In batch but not per-event: [${inBatchNotPerEvent.join(', ')}]`,
  );
  pass('same region key set');
} catch (e) { fail('same region key set', e); }

// Same total shipmentCount
try {
  assert.strictEqual(
    batchTotal,
    perEventTotal,
    `Total shipmentCount mismatch: per-event=${perEventTotal}, batch=${batchTotal}`,
  );
  pass(`total shipmentCount matches (${perEventTotal})`);
} catch (e) { fail('total shipmentCount matches', e); }

// Per-region shipmentCount exact match
try {
  const mismatches: string[] = [];
  for (const [key, perEventRegion] of perEventState.insights) {
    const batchRegion = batchState.insights.get(key);
    if (batchRegion === undefined) {
      mismatches.push(`${key}: per-event has it, batch does not`);
      continue;
    }
    if (batchRegion.shipmentCount !== perEventRegion.shipmentCount) {
      mismatches.push(`${key}: per-event=${perEventRegion.shipmentCount}, batch=${batchRegion.shipmentCount}`);
    }
  }
  assert.ok(
    mismatches.length === 0,
    `Per-region shipmentCount mismatches:\n  ${mismatches.join('\n  ')}`,
  );
  pass('per-region shipmentCount matches exactly');
} catch (e) { fail('per-region shipmentCount matches exactly', e); }

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED — batch nodes diverge from per-event logic.`);
  process.exit(1);
} else {
  console.log(`\nAll assertions passed. Batch path is parity-equivalent to per-event path.`);
}
