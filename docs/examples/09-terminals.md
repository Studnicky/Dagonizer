---
title: 'Phase 09: Terminal placements'
description: 'TerminalNode placements. Three patterns for ending a flow with an explicit completed or failed outcome.'
seeAlso:
  - text: 'DAGBuilder, `.terminal()`'
    link: '../guide/builder'
    description: 'full method reference and signature'
  - text: 'Visualization'
    link: '../guide/visualization'
    description: 'render DAGs with TerminalNode endpoints as Mermaid'
  - text: 'Phase 05: Embedded-DAG composition'
    link: './05-embedded-dags'
    description: 'scatter routing with named terminal targets'
---

<script setup lang="ts">
import {
  DAG_CONTEXT,
  DAGBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { DAG, NodeInterface } from '@noocodex/dagonizer';

class S extends NodeStateBase { shouldPass = true; }

const checkNode: NodeInterface<S, 'pass' | 'fail'> = {
  name: 'check',
  outputs: ['pass', 'fail'],
  async execute(state) { return { output: state.shouldPass ? 'pass' : 'fail' }; },
};

const dag2 = new DAGBuilder('demo-explicit-terminals', '1')
  .node('check', checkNode, { pass: 'end-ok', fail: 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', { outcome: 'failed' })
  .build();

const childDAG: DAG = {
  '@context':  DAG_CONTEXT,
  '@id':       'urn:noocodex:dag:child-for-terminals',
  '@type':     'DAG',
  name:        'child-for-terminals',
  version:     '1',
  entrypoint:  'child-work',
  nodes: [
    {
      '@id':    'urn:noocodex:dag:child-for-terminals/node/child-work',
      '@type':  'SingleNode',
      name:     'child-work',
      node:     'child-work',
      outputs:  { done: 'child-end' },
    },
    {
      '@id':    'urn:noocodex:dag:child-for-terminals/node/child-end',
      '@type':  'TerminalNode',
      name:     'child-end',
      outcome:  'completed',
    },
  ],
};

const dag3 = new DAGBuilder('demo-scatter-terminals', '1')
  .embeddedDAG('run', 'child-for-terminals', { success: 'end-ok', error: 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', { outcome: 'failed' })
  .build();

const terminalsRegistry = new Map([['child-for-terminals', childDAG]]);
</script>

# Phase 09: Terminal placements

`TerminalNode` placements name the endpoints of a flow and carry an `outcome` declaration (`completed` or `failed`). Every flow branch must end at a named `TerminalNode`. Three patterns cover the common cases: an explicit completed terminal, an explicit failed terminal, and embedded-DAG outputs routed to named terminals.

## What it shows

- **Explicit completed terminal.** `.node(..., { ok: 'end' }).terminal('end')`. Declares a named `TerminalNode` placement with the default `outcome: 'completed'`. The diagram shows `end` as a discrete node and the engine marks the state `completed` when execution arrives there.
- **Explicit failed terminal.** `.terminal('end-fail', { outcome: 'failed' })`. Two terminal placements, `end-ok` (completed) and `end-fail` (failed), wired from a check node. The DAG runs twice, once triggering each terminal, producing `completed` and `failed` lifecycle kinds respectively.
- **Embedded-DAG routing to named terminals.** `.embeddedDAG('run', 'child-for-terminals', { success: 'end-ok', error: 'end-fail' })`. The parent registers named terminals and routes the embedded-DAG placement's `success` and `error` outputs directly to them. A child DAG that collects errors surfaces a `failed` lifecycle in the parent.

## The code

<<< @/../examples/09-terminals.ts

## Walkthrough

### Pattern 1: explicit completed terminal

<<< @/../examples/dags/09-terminals.ts#terminal-completed

`.terminal('end')` emits a `TerminalNode` placement with `outcome: 'completed'`. The rendered diagram shows `end` as a named terminus. Use descriptive names like `end-ok`, `response-sent`, or `workflow-complete` when the endpoint name carries meaning.

### Pattern 2: explicit failed terminal

<<< @/../examples/dags/09-terminals.ts#terminal-failed

`.terminal('end-fail', { outcome: 'failed' })` produces a placement with `outcome: 'failed'`. When the engine reaches it, the state lifecycle transitions to `failed` before the flow resolves. The author does not need to call `state.markFailed()` inside any node; the placement itself carries the outcome declaration.

Running the DAG twice with `state.shouldPass = true` and `false` produces:

```
Pattern 2a: check node routes to end-ok
  lifecycle.kind = completed

Pattern 2b: check node routes to end-fail
  lifecycle.kind = failed
```

<DagGraph :dag="dag2" aria-label="demo-explicit-terminals: a check node routes pass to end-ok and fail to end-fail." />

Use this pattern when a named path through the flow has a known semantic outcome: a validation gate that declares the flow as failed rather than silently completing, a circuit-breaker endpoint, an explicit error branch.

### Pattern 3: embedded-DAG routing to named terminals

<<< @/../examples/dags/09-terminals.ts#embedded-terminals

The `EmbeddedDAGNode` placement's `error` output routes to the parent's `end-fail` terminal. When the child DAG accumulates errors (via `state.collectError`), the terminal reducer routes `error`, which arrives at `end-fail`, which marks the parent flow `failed`.

Running the DAG twice:

```
Pattern 3a: scatter child succeeds, end-ok
  lifecycle.kind = completed

Pattern 3b: scatter child errors, end-fail
  lifecycle.kind = failed
```

<DagGraph :dag="dag3" :embedded-d-a-gs="terminalsRegistry" :expand-all="true" aria-label="demo-scatter-terminals: scatter success routes to end-ok and error routes to end-fail." />
