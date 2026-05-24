/**
 * 09-terminals — TerminalNode placements: explicit flow endpoints.
 *
 * A TerminalNode placement ends the flow when reached. The `outcome` field
 * declares whether the dispatcher marks the state `completed` or `failed`.
 * Four patterns are demonstrated:
 *
 *   1. Implicit terminal via null route — `.node('a', nodeA, { ok: null })`
 *      Route to null is sugar for "this branch ends with outcome=completed."
 *      No explicit TerminalNode placement is needed.
 *
 *   2. Explicit completed terminal — `.terminal('end')` (default outcome).
 *      The diagram shows 'end' as a discrete placement; the engine marks the
 *      state `completed` when it arrives there. Functionally identical to a
 *      null route — the value is in the diagram legibility.
 *
 *   3. Explicit failed terminal — `.terminal('end-fail', 'failed')`.
 *      Two terminals: `end-ok` (completed) and `end-fail` (failed). A check
 *      node routes to one depending on state. The DAG runs twice — once
 *      triggering `end-ok`, once triggering `end-fail` — and the lifecycle
 *      kind is printed for each run.
 *
 *   4. Embedded-DAG routing to explicit terminals — `.embeddedDAG('run', 'child', {
 *      success: 'end-ok', error: 'end-fail' })`. A child DAG's success/error
 *      outputs route to the parent's named terminals. A child with errors
 *      routes to `end-fail` → state becomes `failed` in the parent.
 *
 * Run: npx tsx examples/09-terminals.ts
 */

import {
  DAG_CONTEXT,
  DAGBuilder,
  Dagonizer,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class S extends NodeStateBase {
  shouldPass = true;  // controls which terminal the check node routes to
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

const stepA: NodeInterface<S, 'ok'> = {
  "name":    'step-a',
  "outputs": ['ok'],
  async execute(_state) {
    return { "output": 'ok' };
  },
};

const checkNode: NodeInterface<S, 'pass' | 'fail'> = {
  "name":    'check',
  "outputs": ['pass', 'fail'],
  async execute(state) {
    return { "output": state.shouldPass ? 'pass' : 'fail' };
  },
};

// Child DAG work node — used in pattern 4
const childWork: NodeInterface<S, 'done'> = {
  "name":    'child-work',
  "outputs": ['done'],
  async execute(state) {
    if (!state.shouldPass) {
      state.collectError({
        "message":     'child-work failed deliberately',
        "code":        'CHILD_ERR',
        "operation":   'child-work',
        "recoverable": false,
        "timestamp":   new Date().toISOString(),
      });
    }
    return { "output": 'done' };
  },
};

// ---------------------------------------------------------------------------
// Pattern 1 — Implicit terminal via null route
// ---------------------------------------------------------------------------

// #region null-route
const dag1 = new DAGBuilder('demo-null-route', '1')
  .node('step-a', stepA, { 'ok': null })
  .build();
// #endregion null-route

// ---------------------------------------------------------------------------
// Pattern 2 — Explicit completed terminal
// ---------------------------------------------------------------------------

// #region terminal-completed
const dag2 = new DAGBuilder('demo-explicit-completed', '1')
  .node('step-a', stepA, { 'ok': 'end' })
  .terminal('end')  // outcome defaults to 'completed'
  .build();
// #endregion terminal-completed

// ---------------------------------------------------------------------------
// Pattern 3 — Explicit failed terminal (two terminals)
// ---------------------------------------------------------------------------

// #region terminal-failed
const dag3 = new DAGBuilder('demo-explicit-terminals', '1')
  .node('check', checkNode, { 'pass': 'end-ok', 'fail': 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
// #endregion terminal-failed

// ---------------------------------------------------------------------------
// Pattern 4 — Embedded-DAG routing to explicit terminals
// ---------------------------------------------------------------------------

// #region embedded-terminals
const childDAG: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:child-for-terminals',
  '@type':     'DAG',
  "name":      'child-for-terminals',
  "version":   '1',
  "entrypoint": 'child-work',
  "nodes": [
    {
      '@id':    'urn:noocodex:dag:child-for-terminals/node/child-work',
      '@type':  'SingleNode',
      "name":   'child-work',
      "node":   'child-work',
      "outputs": { "done": null },
    },
  ],
};

const dag4 = new DAGBuilder('demo-embedded-dag-terminals', '1')
  .embeddedDAG('run', 'child-for-terminals', {
    'success': 'end-ok',
    'error':   'end-fail',
  })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
// #endregion embedded-terminals

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  // ── Pattern 1 ─────────────────────────────────────────────────────────────
  {
    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(stepA);
    dispatcher.registerDAG(dag1);

    const state = new S();
    const result = await dispatcher.execute('demo-null-route', state);
    process.stdout.write('\nPattern 1 — null route (implicit terminal):\n');
    process.stdout.write(`  lifecycle.kind = ${result.state.lifecycle.kind}\n`);
    // → completed
  }

  // ── Pattern 2 ─────────────────────────────────────────────────────────────
  {
    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(stepA);
    dispatcher.registerDAG(dag2);

    const state = new S();
    const result = await dispatcher.execute('demo-explicit-completed', state);
    process.stdout.write('\nPattern 2 — explicit completed terminal:\n');
    process.stdout.write(`  lifecycle.kind = ${result.state.lifecycle.kind}\n`);
    // → completed
  }

  // ── Pattern 3a — routes to end-ok ─────────────────────────────────────────
  {
    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(checkNode);
    dispatcher.registerDAG(dag3);

    const statePass = new S();
    statePass.shouldPass = true;
    const resultPass = await dispatcher.execute('demo-explicit-terminals', statePass);
    process.stdout.write('\nPattern 3a — check node routes to end-ok:\n');
    process.stdout.write(`  lifecycle.kind = ${resultPass.state.lifecycle.kind}\n`);
    // → completed
  }

  // ── Pattern 3b — routes to end-fail ───────────────────────────────────────
  {
    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(checkNode);
    dispatcher.registerDAG(dag3);

    const stateFail = new S();
    stateFail.shouldPass = false;
    const resultFail = await dispatcher.execute('demo-explicit-terminals', stateFail);
    process.stdout.write('\nPattern 3b — check node routes to end-fail:\n');
    process.stdout.write(`  lifecycle.kind = ${resultFail.state.lifecycle.kind}\n`);
    // → failed
  }

  // ── Pattern 4a — child succeeds → end-ok ──────────────────────────────────
  {
    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(childWork);
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(dag4);

    const stateOk = new S();
    stateOk.shouldPass = true;
    const resultOk = await dispatcher.execute('demo-embedded-dag-terminals', stateOk);
    process.stdout.write('\nPattern 4a — embedded-DAG child succeeds → end-ok:\n');
    process.stdout.write(`  lifecycle.kind = ${resultOk.state.lifecycle.kind}\n`);
    // → completed
  }

  // ── Pattern 4b — child errors → end-fail ──────────────────────────────────
  {
    const dispatcher = new Dagonizer<S>();
    dispatcher.registerNode(childWork);
    dispatcher.registerDAG(childDAG);
    dispatcher.registerDAG(dag4);

    const stateErr = new S();
    stateErr.shouldPass = false;
    const resultErr = await dispatcher.execute('demo-embedded-dag-terminals', stateErr);
    process.stdout.write('\nPattern 4b — embedded-DAG child errors → end-fail:\n');
    process.stdout.write(`  lifecycle.kind = ${resultErr.state.lifecycle.kind}\n`);
    // → failed
  }
}

await run();
