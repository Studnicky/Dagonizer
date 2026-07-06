---
title: 'Authoring DAGs'
description: 'Dagonizer ships one DAG type: a JSON-LD document that is schema-validated and dispatcher-consumed. DAGBuilder is the code factory for that document; serialized JSON-LD is the portable artifact.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'chainable authoring API for deterministic workflows'
  - text: 'JSON-LD export and import'
    link: './json-ld'
    description: 'DAGDocument.serialize and DAGDocument.load'
  - text: 'Concepts'
    link: '../concepts'
    description: 'the DAG type itself and its placement vocabulary'
nextSteps:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'JSON-LD DAG authoring'
---

# Authoring DAGs

The `DAG` type is the API. A `DAG` is a JSON-LD 1.1 document with `@context`, `@id`, `@type`, and a `nodes` array of placement objects. The dispatcher consumes it; the schema validates it; RDF tools read it natively. Code authoring uses `DAGBuilder`; persistence and transport use the same JSON-LD document.

```
                ┌──────────────────────────────────────┐
                │    DAG (JSON-LD canonical)           │   The single API
                │    @context / @id / @type / nodes    │   stable across versions
                │    DAGSchema-validated               │   dispatcher-consumed
                └──────────────────────────────────────┘
                          ▲
                          │
              ┌───────────┴────────┐
              │     DAGBuilder     │
              │                    │
              │  Code factory for  │
              │  JSON-LD DAG       │
              │  documents         │
              └────────────────────┘
```

## DAGBuilder Is The Code Factory

DAGBuilder is the factory for DAG documents in TypeScript. ETL pipelines, transformation chains, agent loops, embedded DAGs, scatter bodies, and fixed sequences use the same fluent surface.

The mental model: *first this, then that, then if X go here else go there.* TypeScript narrows the route map at each `.node()` call from the node's `TOutput` union, so misspelled routes are compile errors before the DAG ever runs.

The builder example registers two nodes and chains them:

<<< @/../examples/dags/02-builder.topology.ts#builder

Use DAGBuilder because:

- A new stage is one more `.node()` link in the chain.
- Routes stay on the page next to the node reference.
- The TypeScript compiler verifies every output is wired.
- `.build()` returns the canonical JSON-LD `DAG` document the dispatcher consumes.

## JSON-LD Documents

<<< @/../examples/dags/03-schema.ts#load

Serialized DAGs are JSON-LD documents. Load them with `DAGDocument.load(json)` at process boundaries and persist them with `DAGDocument.serialize(dag)`. That is transport and storage for the same DAG object, not a second framework abstraction.

## Node implementations sit beside authoring

Authoring decides topology; node implementations carry the work. `NodeInterface<TState, TOutput>` is the contract every node satisfies. The classify-intent node from the Archivist demo declares a seven-value `TOutput` union and routes via `switch`:

<<< @/../examples/the-archivist/nodes/classifyIntent.ts#node-class

The same `classifyIntent` reference is registered with the dispatcher and referenced by name from a placement in the DAG. The authoring surface decides where in the topology this node sits; the node implementation decides what it does and which output it returns.

## Capability Matrix

DAGBuilder emits every placement shape the schema allows.

| Capability | DAGBuilder |
|---|---|
| `SingleNode` placement | yes via `.node()` |
| `ScatterNode` placement | yes via `.scatter()` |
| Gather strategy (`map` / `append` / `partition` / `custom` / `collect` / `discard`) | yes via `options.gather` |
| Outcome reducer (`aggregate` / `all-success` / `any-success` / custom) | yes via `options.reducer` |
| Scatter body variant (`node`, `dag`, or `dagFrom`) | yes via `body` argument |
| `EmbeddedDAGNode` placement | yes via `.embeddedDAG()` |
| `TerminalNode` placement | yes via `.terminal()` |
| `inputs` (parent -> clone seed) | yes via `options.inputs` |
| Multi-port routing | yes via `routes` map |
| Compile-time route narrowing | yes from `NodeInterface` `TOutput` |
| Runtime-conditional topology | yes by conditionally adding placements before `.build()` |
| Recursive / trampoline flows | yes via `services.dispatcher.execute` inside node logic |

A node that recursively dispatches a sub-DAG via `services.dispatcher.execute(name, state.clone())` is a trampoline; it lives in node logic while DAGBuilder owns the topology.

## Terminal placements

Every DAG branch must end at a named `TerminalNode` placement. Declare one with `.terminal(name, options?)`:

<<< @/../examples/dags/09-terminals.ts#terminal-completed

`.terminal(name, options?)` emits a `TerminalNode` placement. When the engine reaches it, the flow ends with the declared `outcome` (`'completed'` by default). To mark a branch as `failed`, pass `{ outcome: 'failed' }`:

<<< @/../examples/dags/09-terminals.ts#terminal-failed

Named terminals appear as discrete nodes in the visualisation. Use descriptive names (`end-ok`, `response-sent`, `workflow-failed`) when the endpoint name carries meaning.

An `EmbeddedDAGNode` placement targets named terminals directly. This is the idiomatic way to surface a child DAG's error as a `failed` lifecycle in the parent:

<<< @/../examples/dags/09-terminals.ts#embedded-terminals

See [DAGBuilder, `.terminal()`](./builder#terminal-name-outcome) and [Phase 09, Terminal placements](../examples/09-terminals) for runnable examples.

## Error-routing contract

Nodes never throw past the node boundary. An error condition is a **flow decision**: the node returns the failed items on an `'error'` routed sub-batch and the DAG routes that output to a recovery node or an error terminal. The engine does not intercept throws and reroute them.

This means every node that can fail must:
1. Declare `'error'` (or a domain-specific name like `'salvage'`) as one of its output ports.
2. Return a routed sub-batch on `'error'` when the failure condition is met.
3. Have that output wired to a downstream placement in the DAG.

```ts
// Correct: declare the error port, return it on failure
class FetchNode extends MonadicNode<MyState, 'success' | 'error'> {
  readonly name = 'fetch';
  readonly outputs: readonly ('success' | 'error')[] = ['success', 'error'];

  override get outputSchema(): Record<'success' | 'error', SchemaObjectType> {
    return MonadicNode.permissiveSchema(this.outputs);
  }

  async execute(batch: Batch<MyState>, context: NodeContextType): Promise<RoutedBatchType<'success' | 'error', MyState>> {
    const succeeded: ItemType<MyState>[] = [];
    const failed: ItemType<MyState>[] = [];
    for (const item of batch) {
      try {
        item.state.result = await fetchData(context.signal);
        succeeded.push(item);
      } catch (err) {
        item.state.collectError(NodeError.create('fetchFailed', String(err), 'fetch', false, new Date().toISOString()));
        failed.push(item);
      }
    }
    return RoutedBatch.create([
      ['success', Batch.from(succeeded)],
      ['error', Batch.from(failed)],
    ]);
  }
}

// Wire the error output in the DAG
const dag = new DAGBuilder('pipeline', '1.0')
  .node('fetch', fetchNode, { success: 'process', error: 'end-fail' })
  .node('process', processNode, { success: 'end-ok' })
  .terminal('end-ok')
  .terminal('end-fail', { outcome: 'failed' })
  .build();
```

If a node truly throws (an unexpected bug, not a handled error condition), the exception propagates as an engine-level failure and the lifecycle transitions to `failed`. This is distinct from routing to an `'error'` port, which is a deliberate flow decision the DAG topology controls.

## Loading JSON-LD

Use `DAGDocument.load(jsonString)` to validate a serialized DAG at the ingest boundary; the engine refuses anything that does not match `DAGSchema`. See [JSON-LD export and import](./json-ld) for details.

## Related reference

- [Phase 02, DAGBuilder demo](../examples/02-builder)
- [Reference, Dagonizer](../reference/dagonizer)
- [Reference, Entities](../reference/entities)
