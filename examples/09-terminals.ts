/**
 * 09-terminals: TerminalNode placements, explicit flow endpoints.
 *
 * A TerminalNode placement ends the flow when reached. The `outcome` field
 * declares whether the dispatcher marks the state `completed` or `failed`.
 * Three patterns are demonstrated:
 *
 *   1. Explicit completed terminal: `.terminal('end')` (default outcome).
 *      The diagram shows 'end' as a discrete placement; the engine marks the
 *      state `completed` when it arrives there.
 *
 *   2. Explicit failed terminal: `.terminal('end-fail', { outcome: 'failed' })`.
 *      Two terminals: `end-ok` (completed) and `end-fail` (failed). A check
 *      node routes to one depending on state. The DAG runs twice, once
 *      triggering `end-ok` and once triggering `end-fail`, and the lifecycle
 *      kind is printed for each run.
 *
 *   3. EmbeddedDAGNode routing to explicit terminals: `.embeddedDAG('run',
 *      'child', { success: 'end-ok', error: 'end-fail' })`. A child
 *      DAG's success/error outputs route to the parent's named terminals.
 *      A child with errors routes to `end-fail` and state becomes `failed`.
 *
 * DAG definitions (state, nodes, dag1-dag4, childDAG): examples/dags/09-terminals.ts
 *
 * Run: npx tsx examples/09-terminals.ts
 */

import { Dagonizer } from '@studnicky/dagonizer';
import {
  GateState,
  StepANode,
  CheckNode,
  ChildWorkNode,
  childDAG,
  dag1,
  dag2,
  dag4,
} from './dags/09-terminals.js';

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// ── Pattern 1: explicit completed terminal ─────────────────────────────────
{
  const dispatcher = new Dagonizer<GateState>();
  dispatcher.registerNode(new StepANode());
  dispatcher.registerDAG(dag1);

  const state = new GateState();
  const result = await dispatcher.execute('demo-explicit-completed', state);
  process.stdout.write('\nPattern 1: explicit completed terminal:\n');
  process.stdout.write(`  lifecycle.kind = ${result.state.lifecycle.kind}\n`);
  // → completed
}

// ── Pattern 2a: check node routes to end-ok ───────────────────────────────
{
  const dispatcher = new Dagonizer<GateState>();
  dispatcher.registerNode(new CheckNode());
  dispatcher.registerDAG(dag2);

  const statePass = new GateState();
  statePass.shouldPass = true;
  const resultPass = await dispatcher.execute('demo-explicit-terminals', statePass);
  process.stdout.write('\nPattern 2a: check node routes to end-ok:\n');
  process.stdout.write(`  lifecycle.kind = ${resultPass.state.lifecycle.kind}\n`);
  // → completed
}

// ── Pattern 2b: check node routes to end-fail ─────────────────────────────
{
  const dispatcher = new Dagonizer<GateState>();
  dispatcher.registerNode(new CheckNode());
  dispatcher.registerDAG(dag2);

  const stateFail = new GateState();
  stateFail.shouldPass = false;
  const resultFail = await dispatcher.execute('demo-explicit-terminals', stateFail);
  process.stdout.write('\nPattern 2b: check node routes to end-fail:\n');
  process.stdout.write(`  lifecycle.kind = ${resultFail.state.lifecycle.kind}\n`);
  // → failed
}

// ── Pattern 3a: child succeeds -> end-ok ──────────────────────────────────
{
  const dispatcher = new Dagonizer<GateState>();
  dispatcher.registerNode(new ChildWorkNode());
  dispatcher.registerDAG(childDAG);
  dispatcher.registerDAG(dag4);

  const stateOk = new GateState();
  stateOk.shouldPass = true;
  const resultOk = await dispatcher.execute('demo-embedded-dag-terminals', stateOk);
  process.stdout.write('\nPattern 3a: scatter child DAG succeeds -> end-ok:\n');
  process.stdout.write(`  lifecycle.kind = ${resultOk.state.lifecycle.kind}\n`);
  // → completed
}

// ── Pattern 3b: child errors -> end-fail ──────────────────────────────────
{
  const dispatcher = new Dagonizer<GateState>();
  dispatcher.registerNode(new ChildWorkNode());
  dispatcher.registerDAG(childDAG);
  dispatcher.registerDAG(dag4);

  const stateErr = new GateState();
  stateErr.shouldPass = false;
  const resultErr = await dispatcher.execute('demo-embedded-dag-terminals', stateErr);
  process.stdout.write('\nPattern 3b: scatter child DAG errors -> end-fail:\n');
  process.stdout.write(`  lifecycle.kind = ${resultErr.state.lifecycle.kind}\n`);
  // → failed
}
