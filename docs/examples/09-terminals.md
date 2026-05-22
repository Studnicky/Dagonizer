---
title: 'Phase 09 · Terminal placements'
description: 'TerminalNode placements and null-route sugar — four patterns for ending a flow with an explicit completed or failed outcome.'
seeAlso:

  - text: 'DAGBuilder — .terminal()'

    link: '../guide/builder'
    description: 'full method reference and signature'

  - text: 'Visualization'

    link: '../guide/visualization'
    description: 'render DAGs with TerminalNode endpoints as Mermaid'

  - text: 'Phase 05 · Deep-DAG composition'

    link: './05-deepflows'
    description: 'deep-DAG routing including null and named terminal targets'
---

# Phase 09 · Terminal placements

## What it shows

- **Implicit terminal via null route** — `.node('step-a', stepA, { ok: null })`. Routing an output to `null` is sugar for "this branch ends with `outcome: completed`." No explicit placement is required. Use this when the endpoint needs no name in the diagram.
- **Explicit completed terminal** — `.node(..., { ok: 'end' }).terminal('end')`. Declares a named `TerminalNode` placement with the default `outcome: 'completed'`. The diagram shows `end` as a discrete node; the engine behavior is identical to a null route.
- **Explicit failed terminal** — `.terminal('end-fail', 'failed')`. Two terminal placements — `end-ok` (completed) and `end-fail` (failed) — wired from a check node. The DAG runs twice, once triggering each terminal, producing `completed` and `failed` lifecycle kinds respectively.
- **DeepDAG routing to named terminals** — `.deepDAG('run', 'child', { success: 'end-ok', error: 'end-fail' })`. The parent registers named terminals and routes the child's `success` / `error` outputs directly to them. A child that collects errors surfaces a `failed` lifecycle in the parent.

## The code

<<< ../../examples/09-terminals.ts

## Walkthrough

### Pattern 1 — null route

```ts
const dag = new DAGBuilder('demo-null-route', '1')
  .node('step-a', stepA, { ok: null })
  .build();
```

`null` in the routes map ends the flow. The lifecycle resolves to `completed` by default. This is the shortest form and sufficient when the endpoint has no semantic meaning beyond "done."

### Pattern 2 — explicit completed terminal

```ts
const dag = new DAGBuilder('demo-explicit-completed', '1')
  .node('step-a', stepA, { ok: 'end' })
  .terminal('end')
  .build();
```

`.terminal('end')` emits a `TerminalNode` placement with `outcome: 'completed'`. The outcome is identical to the null route in pattern 1. The reason to prefer this form is diagram clarity: the Mermaid output will show `end` as a named terminus rather than an implicit edge-to-nowhere. This is worth the extra line when the endpoint name carries meaning (`end-ok`, `response-sent`, `workflow-complete`).

### Pattern 3 — explicit failed terminal

```ts
const dag = new DAGBuilder('demo-explicit-terminals', '1')
  .node('check', checkNode, { pass: 'end-ok', fail: 'end-fail' })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
```

`terminal('end-fail', 'failed')` produces a placement with `outcome: 'failed'`. When the engine reaches it, the state lifecycle transitions to `failed` before the flow resolves. The author does not need to call `state.markFailed()` inside any node — the placement itself carries the outcome declaration.

Running the DAG twice with `state.shouldPass = true` / `false` produces:

```
Pattern 3a — check node routes to end-ok:
  lifecycle.kind = completed

Pattern 3b — check node routes to end-fail:
  lifecycle.kind = failed
```

Use this pattern when a named path through the flow has a known semantic outcome — a validation gate that declares flow-as-failed rather than silently completing, a circuit-breaker endpoint, an explicit error branch.

### Pattern 4 — DeepDAG routing to named terminals

```ts
const dag = new DAGBuilder('demo-deepdag-terminals', '1')
  .deepDAG('run', 'child-for-terminals', {
    success: 'end-ok',
    error:   'end-fail',
  })
  .terminal('end-ok')
  .terminal('end-fail', 'failed')
  .build();
```

The `DeepDAGNode` placement's `error` output routes to the parent's `end-fail` terminal. When the child DAG accumulates errors (via `state.collectError`), the engine routes the deep-DAG placement to its `error` output, which arrives at `end-fail`, which marks the parent flow `failed`.

Prior to `TerminalNode`, routing a deep-DAG `error` output to `null` would silently complete the flow — an error in the child had no effect on the parent lifecycle unless the author added a dedicated SingleNode just to call `state.markFailed()`. The named terminal collapses that pattern to one `.terminal(name, 'failed')` call.

Running the DAG twice:

```
Pattern 4a — deep-DAG child succeeds → end-ok:
  lifecycle.kind = completed

Pattern 4b — deep-DAG child errors → end-fail:
  lifecycle.kind = failed
```

## Diagram

The Mermaid below reflects the `demo-explicit-terminals` DAG (pattern 3). Render any built DAG via `MermaidRenderer.render(dag)` from `@noocodex/dagonizer/viz`.

```mermaid
flowchart TB
  check[check]
  end-ok([end-ok\noutcome: completed])
  end-fail([end-fail\noutcome: failed])
  check -->|pass| end-ok
  check -->|fail| end-fail
```

For pattern 4 (deep-DAG terminals):

```mermaid
flowchart TB
  run([run\n.deepDAG child-for-terminals])
  end-ok([end-ok\noutcome: completed])
  end-fail([end-fail\noutcome: failed])
  run -->|success| end-ok
  run -->|error| end-fail
```
