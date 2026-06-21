---
title: 'Example 27: Recursion via dagFrom'
description: 'A countdown DAG embeds itself at runtime using dagFrom state resolution. Each recursive frame accumulates a value then either continues the recursion or hits the base case and terminates. Demonstrates isolated child state, runtime DAG-name resolution, and stateMapping across recursive call boundaries.'
seeAlso:
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
    description: 'the stateMapping.input / stateMapping.output pattern'
  - text: 'Phase 04: Scatter scout'
    link: './04-scatter'
    description: 'parallel fan-out — a complement to recursive fan-in'
  - text: 'Reference: Entities, EmbeddedDAGNode'
    link: '../reference/entities'
  - text: 'Reference: Execution'
    link: '../reference/execution'
---

# Example 27: Recursion via `dagFrom`

Dagonizer supports true self-referential DAGs. An `EmbeddedDAGNode` placement
can resolve its target DAG name from **state at runtime** using the `dagFrom`
field — and because every embedded invocation runs on a **fresh, isolated child
state**, a DAG can safely embed itself with no stack pollution or shared-state
collisions between recursive frames.

## What it demonstrates

- **`dagFrom` runtime resolution.** The `embed` placement declares
  `dagFrom: 'dagName'` instead of a static `dag: 'countdown'` string. Before
  executing the placement the engine reads `state.dagName` (a string field on
  `CountdownState`) and uses that value to look up the sub-DAG in the registry.
  Because `state.dagName === 'countdown'`, the DAG runs itself.

- **Isolated child state makes recursion safe.** Each recursive frame gets a
  **fresh `CountdownState` instance** — not a clone of the parent's full state.
  The engine seeds it with only the fields listed in `stateMapping.input`, runs
  the child DAG to completion, and then copies the fields listed in
  `stateMapping.output` back into the parent. Undeclared fields on the parent
  are never visible to the child and cannot be corrupted by it.

- **Base case via output routing.** `AccumulateNode` routes to `'base'` when
  `remaining === 0` and to `'recurse'` when `remaining > 0`. The `accumulate`
  placement routes `'base'` directly to `base-end` (a `TerminalNode`), so the
  chain unwinds naturally without any sentinel value in state or a special node
  type.

- **Accumulator threading via `stateMapping`.** Before each recursive call the
  parent frame passes `total` to the child through `stateMapping.input`.  After
  the child DAG completes the child's `total` is written back to the parent
  through `stateMapping.output`.  This pattern correctly accumulates a value
  across an arbitrary recursion depth.

- **Deterministic result.** `countdown(5)` sums 5 + 4 + 3 + 2 + 1 + 0 = **15**.
  `countdown(N)` always produces `N * (N + 1) / 2`.

## State

```ts twoslash
import { NodeStateBase } from '@studnicky/dagonizer';

class CountdownState extends NodeStateBase {
  /** The registered name of this DAG — read by the engine for `dagFrom` lookup. */
  dagName       = 'countdown';
  /** How many steps remain before the base case. */
  remaining     = 0;
  /** Accumulated sum across all recursive frames. */
  total         = 0;
  /** Scratch field: remaining - 1, written before the recursive embed. */
  nextRemaining = 0;
}
```

`dagName` is a plain string field.  The engine reads it via `dagFrom: 'dagName'`
in the placement definition — no special registration or annotation needed.

## Accumulate node

<<< @/../examples/dags/27-recursion.ts#node

`AccumulateNode` adds `remaining` to `total`, pre-computes `nextRemaining`, and
picks the output route.  The placement wires `'base'` straight to a terminal and
`'recurse'` to the `EmbeddedDAGNode` that triggers the next frame.

## DAG topology

```
accumulate  ──── base ──► base-end  (TerminalNode, completed)
            └─── recurse ──► embed  (EmbeddedDAGNode)
                               ├── success ──► end       (completed)
                               └── error   ──► end-error (failed)
```

Full DAG literal:

<<< @/../examples/dags/27-recursion.ts#dag

## How `dagFrom` resolves at runtime

The `embed` placement:

```ts
{
  '@type':  'EmbeddedDAGNode',
  "name":   'embed',
  "dagFrom": 'dagName',          // ← resolved from state at execution time
  "stateMapping": {
    "input":  {
      "dagName":   'dagName',    // propagate the DAG name into the child
      "remaining": 'nextRemaining',
      "total":     'total',
    },
    "output": {
      "total": 'total',          // carry the accumulator back up
    },
  },
  "outputs": { "success": 'end', "error": 'end-error' },
}
```

Resolution order:

1. Engine reaches the `embed` placement.
2. `EmbeddedDAGNodeDefaults.resolveDagName` reads `state['dagName']` via the
   state accessor.
3. The returned string (`'countdown'`) is looked up in the dispatcher's DAG
   registry — the same map that was populated by `dispatcher.registerDAG(countdownDAG)`.
4. A fresh `CountdownState` is spawned and seeded via `stateMapping.input`.
5. The engine runs `'countdown'` from its `entrypoint` node (`'accumulate'`) on
   the child state.
6. On completion the output mapping writes `child.total` back into `parent.total`.

If `state.dagName` is missing or resolves to a name that is not registered, the
engine routes the placement to its `'error'` output without throwing.

## Running the example

<<< @/../examples/27-recursion.ts#run

```
$ npx tsx examples/27-recursion.ts

Recursive countdown via dagFrom runtime resolution
  remaining=5 → 5+4+3+2+1+0 = 15
  terminalOutcome: completed
```

## Design notes

**Why not a static `dag:` field?** A static `dag: 'countdown'` would also work
for this example — the DAG is registered before execution, so the name is
already known at build time.  `dagFrom` is demonstrated here because it is the
more general primitive: it enables a *heterogeneous* recursive structure where
different branches invoke different sub-DAGs based on runtime data (e.g. a tree
whose leaf nodes run a different DAG than its branch nodes).

**Stack depth vs. scatter.** Each recursive invocation is sequential and
synchronous within the engine (the parent awaits the child).  For wide trees
where children can be processed in parallel, a `ScatterNode` with `dagFrom` on
each item fans out N child invocations concurrently.  Recursion is the right
shape for *depth-first* traversal; scatter is right for *breadth-first*
fan-out.

**Termination guarantee.** The base case (`remaining === 0 → 'base'`) is
enforced in the node, not by the engine.  Infinite recursion (no base case)
will exhaust the process call stack.  Always guarantee a decreasing metric that
reaches the base case in finite steps.
