/**
 * 14-gather-strategies: side-by-side comparison of `collect` and `discard`
 * gather strategies — the two strategies with no prior example.
 *
 * `collect` (new in 0.18): gathers each clone's output token (or a named
 * clone field via `field`) into a target array on the parent state, in
 * source-index order. Every clone contributes one entry to the result
 * collection; the parent sees an ordered array of tokens/values.
 *
 * `discard`: explicit no-op. Clones run for side-effects only. Nothing
 * is ever merged back into the parent state. The parent state after the
 * scatter is byte-identical to the parent state before it (modulo lifecycle).
 * Use this when scatter bodies write externally (queues, databases, HTTP)
 * and produce no parent-visible output.
 *
 * Both strategies share the same worker node (`tag`) so the difference is
 * purely in the gather config, not in the execution body.
 *
 * Watch:
 *   collect run → state.tokens = ['done', 'done', 'done', 'done']
 *   discard run → state.tokens = []  (nothing merged)
 *
 * DAG definitions: examples/dags/14-gather-strategies.ts
 *
 * Run: npx tsx examples/14-gather-strategies.ts
 */

import { Dagonizer } from '@noocodex/dagonizer';
import {
  GatherDemoState,
  tag,
  collectDag,
  discardDag,
} from './dags/14-gather-strategies.js';

// ---------------------------------------------------------------------------
// Run: collect strategy
// ---------------------------------------------------------------------------

// #region run-collect
const collectDispatcher = new Dagonizer<GatherDemoState>();
collectDispatcher.registerNode(tag);
collectDispatcher.registerDAG(collectDag);

const collectState = new GatherDemoState();
collectState.items = ['alpha', 'bravo', 'charlie', 'delta'];

await collectDispatcher.execute('collect-run', collectState);

process.stdout.write('\n=== collect strategy ===\n');
process.stdout.write(`  source items: ${JSON.stringify(collectState.items)}\n`);
process.stdout.write(`  tokens (collect target): ${JSON.stringify(collectState.tokens)}\n`);
process.stdout.write(`  length match: ${collectState.tokens.length === collectState.items.length}\n`);
// #endregion run-collect

// ---------------------------------------------------------------------------
// Run: discard strategy
// ---------------------------------------------------------------------------

// #region run-discard
const discardDispatcher = new Dagonizer<GatherDemoState>();
discardDispatcher.registerNode(tag);
discardDispatcher.registerDAG(discardDag);

const discardState = new GatherDemoState();
discardState.items = ['alpha', 'bravo', 'charlie', 'delta'];

await discardDispatcher.execute('discard-run', discardState);

process.stdout.write('\n=== discard strategy ===\n');
process.stdout.write(`  source items: ${JSON.stringify(discardState.items)}\n`);
process.stdout.write(`  tokens (collect target): ${JSON.stringify(discardState.tokens)}\n`);
process.stdout.write(`  sideEffects (clone writes): ${JSON.stringify(discardState.sideEffects)}\n`);
// #endregion run-discard

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write('\n--- Lesson ---\n');
process.stdout.write('collect: each clone\'s output token aggregated into parent → tokens has one entry per item.\n');
process.stdout.write('discard: no merge; clone writes are dropped → tokens stays empty, sideEffects stays empty.\n');
process.stdout.write('Use collect when each clone produces a value the parent must read.\n');
process.stdout.write('Use discard when clones fire-and-forget: write externally, produce no parent result.\n');
