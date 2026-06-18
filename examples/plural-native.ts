/**
 * plural-native: batch-native MonadicNode taxonomy and reservoir-scatter DAG.
 *
 * Demonstrates:
 *   1. EchoNode — a minimal MonadicNode that passes the whole batch through.
 *   2. GeoNode (ScalarNode) and EnrichNode (MonadicNode) side by side.
 *   3. A reservoir-configured scatter DAG registered and executed.
 *
 * DAG definition (nodes, DAG): examples/dags/plural-native.ts
 *
 * Run: npx tsx examples/plural-native.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import {
  EchoNode,
  EnrichNode,
  EventState,
  GeoNode,
  ScoreNode,
  ScoreState,
  reservoirDag,
} from './dags/plural-native.js';

process.stdout.write('\n=== plural-native: batch-native node taxonomy ===\n\n');

// ── 1. EchoNode: minimal MonadicNode round-trip ──────────────────────────────

const echoDispatcher = new Dagonizer<EventState>();
const echoNode = new EchoNode();

// EchoNode is not registered in a DAG here; just verify construction.
process.stdout.write(`EchoNode name: ${echoNode.name}\n`);

// ── 2. GeoNode vs EnrichNode: same EventState, different execute granularity ─

const geoNode    = new GeoNode();
const enrichNode = new EnrichNode();

process.stdout.write(`GeoNode name:    ${geoNode.name}  (per-item ScalarNode)\n`);
process.stdout.write(`EnrichNode name: ${enrichNode.name}  (batch-native MonadicNode)\n`);

void echoDispatcher;

// ── 3. Reservoir scatter DAG: ScoreNode registered on reservoirDag ───────────

const scoreState = new ScoreState();
scoreState.items = [
  { route: 'a', value: 1 },
  { route: 'a', value: 2 },
  { route: 'b', value: 3 },
];

const dispatcher = new Dagonizer<ScoreState>();
dispatcher.registerNode(new ScoreNode());
dispatcher.registerDAG(reservoirDag);

const result = await dispatcher.execute('plural-native-demo', scoreState);

process.stdout.write(`\nReservoir scatter result:\n`);
process.stdout.write(`  terminalOutcome: ${result.terminalOutcome}\n`);
process.stdout.write(`  executedNodes:   ${result.executedNodes}\n`);
