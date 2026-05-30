---
title: 'Phase 09: Terminal placements'
description: 'TerminalNode placements and null-route sugar. Four patterns for ending a flow with an explicit completed or failed outcome.'
seeAlso:
  - text: 'DAGBuilder, `.terminal()`'
    link: '../guide/builder'
    description: 'full method reference and signature'
  - text: 'Visualization'
    link: '../guide/visualization'
    description: 'render DAGs with TerminalNode endpoints as Mermaid'
  - text: 'Phase 05: Embedded-DAG composition'
    link: './05-embedded-dags'
    description: 'scatter routing including null and named terminal targets'
---

<script setup lang="ts">
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { ElementDefinition } from 'cytoscape';
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

const dag3 = new DAGBuilder('demo-explicit-terminals', '1')
  .node('check', checkNode, { pass: 'end-ok', fail: 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
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
      outputs:  { done: null },
    },
  ],
};

const dag4 = new DAGBuilder('demo-scatter-terminals', '1')
  .embeddedDAG('run', 'child-for-terminals', { success: 'end-ok', error: 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();

const elementsP3 = CytoscapeRenderer.render(dag3) as ElementDefinition[];
const elementsP4 = CytoscapeRenderer.render(dag4, {
  embeddedDAGs: new Map([['child-for-terminals', childDAG]]),  // embeddedDAGs option expands ScatterNode sub-DAG bodies
}) as ElementDefinition[];
</script>

# Phase 09: Terminal placements

`TerminalNode` placements name the endpoints of a flow and carry an `outcome` declaration (`completed` or `failed`). Four patterns cover the common cases: an implicit null-route terminal, an explicit completed terminal, an explicit failed terminal, and scatter outputs routed directly to named terminals.

## What it shows

- **Implicit terminal via null route.** `.node('step-a', stepA, { ok: null })`. Routing an output to `null` is sugar for "this branch ends with `outcome: completed`." No explicit placement is required. Use this when the endpoint needs no name in the diagram.
- **Explicit completed terminal.** `.node(..., { ok: 'end' }).terminal('end')`. Declares a named `TerminalNode` placement with the default `outcome: 'completed'`. The diagram shows `end` as a discrete node; the engine behavior is identical to a null route.
- **Explicit failed terminal.** `.terminal('end-fail', 'failed')`. Two terminal placements, `end-ok` (completed) and `end-fail` (failed), wired from a check node. The DAG runs twice, once triggering each terminal, producing `completed` and `failed` lifecycle kinds respectively.
- **Embedded-DAG routing to named terminals.** `.embeddedDAG('run', 'child-for-terminals', { success: 'end-ok', error: 'end-fail' })`. The parent registers named terminals and routes the embedded-DAG placement's `success` and `error` outputs directly to them. A child DAG that collects errors surfaces a `failed` lifecycle in the parent.

## The code

<<< @/../examples/09-terminals.ts

## Walkthrough

### Pattern 1: null route

<<< @/../examples/dags/09-terminals.ts#null-route

`null` in the routes map ends the flow. The lifecycle resolves to `completed` by default. This is the shortest form, sufficient when the endpoint has no semantic meaning beyond "done."

### Pattern 2: explicit completed terminal

<<< @/../examples/dags/09-terminals.ts#terminal-completed

`.terminal('end')` emits a `TerminalNode` placement with `outcome: 'completed'`. The outcome is identical to the null route in pattern 1. The reason to prefer this form is diagram clarity: the rendered diagram shows `end` as a named terminus rather than an implicit edge-to-nowhere. Worth the extra line when the endpoint name carries meaning (`end-ok`, `response-sent`, `workflow-complete`).

### Pattern 3: explicit failed terminal

<<< @/../examples/dags/09-terminals.ts#terminal-failed

`terminal('end-fail', 'failed')` produces a placement with `outcome: 'failed'`. When the engine reaches it, the state lifecycle transitions to `failed` before the flow resolves. The author does not need to call `state.markFailed()` inside any node; the placement itself carries the outcome declaration.

Running the DAG twice with `state.shouldPass = true` and `false` produces:

```
Pattern 3a: check node routes to end-ok
  lifecycle.kind = completed

Pattern 3b: check node routes to end-fail
  lifecycle.kind = failed
```

<DagGraph :elements="elementsP3" aria-label="demo-explicit-terminals: a check node routes pass to end-ok and fail to end-fail." />

Use this pattern when a named path through the flow has a known semantic outcome: a validation gate that declares the flow as failed rather than silently completing, a circuit-breaker endpoint, an explicit error branch.

### Pattern 4: embedded-DAG routing to named terminals

<<< @/../examples/dags/09-terminals.ts#embedded-terminals

The `EmbeddedDAGNode` placement's `error` output routes to the parent's `end-fail` terminal. When the child DAG accumulates errors (via `state.collectError`), the `terminal` reducer routes `error`, which arrives at `end-fail`, which marks the parent flow `failed`.

Without a named terminal, routing an embedded-DAG `error` output to `null` would silently complete the flow: an error in the child had no effect on the parent lifecycle unless the author added a dedicated SingleNode whose sole purpose was to call `state.markFailed()`. The named terminal collapses that pattern to one `.terminal(name, 'failed')` call.

Running the DAG twice:

```
Pattern 4a: scatter child succeeds, end-ok
  lifecycle.kind = completed

Pattern 4b: scatter child errors, end-fail
  lifecycle.kind = failed
```

<DagGraph :elements="elementsP4" aria-label="demo-scatter-terminals: scatter success routes to end-ok and error routes to end-fail." />
