---
'@noocodex/dagonizer': minor
---

Promote the DAG terminal endpoint to a first-class placement.

`TerminalNode` is a new placement kind with `@type: 'TerminalNode'`, a `name`, and `outcome: 'completed' | 'failed'`. The placement ends the flow when reached; the engine reads `outcome` and dispatches `markCompleted()` or `markFailed(...)` on the top-level run.

`DAGBuilder.terminal(name, outcome?)` is the authoring surface. Default outcome is `'completed'`. Routes may target a terminal placement by name from `.node()`, `.parallel()`, `.fanOut()`, or `.deepDAG()` uniformly.

Deep-DAG placements may now route any output to `null` (sugar for terminate-completed) or to a named `TerminalNode`. The registration-time null-route ban for deep-DAGs is removed. The `isDeepDag` flag in `runNodes` continues to own lifecycle scoping for nested execution.

`ExecutionResultInterface` gains `terminalOutcome: 'completed' | 'failed' | null`. The engine sets it when a flow exits through a TerminalNode; it is `null` for null-route exits, error paths, and aborts. The deep-DAG executor reads it from the inner DAG's result to route the parent placement — an inner `TerminalNode(failed)` propagates as `error` on the parent regardless of whether the inner DAG collected NodeError records.

`DAGDeriverTerminal` becomes a discriminated union. The legacy `{ outcome, target: string | null }` variant is preserved; a new `{ outcome, emit: { name, outcome } }` variant directs the deriver to synthesize a `TerminalNode` placement (deduplicated by name; outcome conflicts and operation-name collisions throw at derive time).

`MermaidRenderer`, `CytoscapeRenderer`, and `JsonLdRenderer` render TerminalNode placements as discrete graph entities. Mermaid uses a double-circle shape for `outcome: 'completed'` and an asymmetric flag for `'failed'`. Cytoscape emits `data.type === 'terminal'` with `data.outcome` and marks the synthetic END node with `data.synthetic: true`. JSON-LD output uses `@type: 'dag:TerminalNode'` with `dag:outcome`.
