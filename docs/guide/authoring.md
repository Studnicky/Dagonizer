---
title: 'Authoring DAGs'
description: 'Dagonizer ships one DAG type (JSON-LD canonical, schema-validated, dispatcher-consumed) and two authoring journeys to produce it: DAGBuilder for deterministic workflows, and raw DAG literals for programmatic or JSON-based composition. Pick the journey that matches the mental model you use to describe the flow.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'chainable authoring API for deterministic workflows'
  - text: 'JSON-LD export and import'
    link: './json-ld'
    description: 'raw DAG literals via DAGDocument.serialize and DAGDocument.load'
  - text: 'Concepts'
    link: '../concepts'
    description: 'the DAG type itself and its placement vocabulary'
nextSteps:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'imperative authoring'
---

# Authoring DAGs

The `DAG` type is the API. A `DAG` is a JSON-LD 1.1 document with `@context`, `@id`, `@type`, and a `nodes` array of placement objects. The dispatcher consumes it; the schema validates it; RDF tools read it natively. Every authoring surface in Dagonizer produces this same canonical object.

```
                ┌──────────────────────────────────────┐
                │    DAG (JSON-LD canonical)           │   The single API
                │    @context / @id / @type / nodes    │   stable across versions
                │    DAGSchema-validated               │   dispatcher-consumed
                └──────────────────────────────────────┘
                          ▲                  ▲
                          │                  │
              ┌───────────┴────────┐  ┌──────┴──────────┐
              │     DAGBuilder     │  │  Raw DAG literal │
              │                    │  │                  │
              │  Chainable API for │  │  Written by hand │
              │  deterministic     │  │  or generated    │
              │  workflows         │  │  from a template │
              └────────────────────┘  └──────────────────┘
```

Two authoring journeys, one API. Pick the journey that matches how you describe the flow to another engineer.

## DAGBuilder when you control the order

DAGBuilder is for deterministic workflows you control end-to-end. ETL pipelines, transformation chains, fixed sequences where the order IS the spec.

The mental model: *first this, then that, then if X go here else go there.* TypeScript narrows the route map at each `.node()` call from the node's `TOutput` union, so misspelled routes are compile errors before the DAG ever runs.

The builder example registers two nodes and chains them:

<<< @/../examples/dags/02-builder.topology.ts#builder

Choose DAGBuilder when:

- The flow is a fixed pipeline. A new stage is one more `.node()` link in the chain.
- Routes are unambiguous and you want them on the page next to the node reference.
- The TypeScript compiler should verify every output is wired.
- The flow is short-lived (one-off composition, generated from a template, etc.).

## Raw `DAG` literals, always available

Both sugar layers produce the same `DAG` object. A literal can also be written directly: useful for code generation, JSON loaded from disk, fixture data in tests, or programmatic composition.

<<< @/../examples/dags/03-schema.ts#load

See [JSON-LD export and import](./json-ld) for the canonical shape, round-trip semantics, and persistence patterns.

## Node implementations sit beside authoring

Authoring decides topology; node implementations carry the work. `NodeInterface<TState, TOutput>` is the contract every node satisfies. The classify-intent node from the Archivist demo declares a seven-value `TOutput` union and routes via `switch`:

<<< @/../examples/the-archivist/nodes/classifyIntent.ts#node-class

The same `classifyIntent` reference is registered with the dispatcher and referenced by name from a placement in the DAG. The authoring surface decides where in the topology this node sits; the node implementation decides what it does and which output it returns.

## Decision matrix

| Question | DAGBuilder | Raw `DAG` |
|---|---|---|
| "I have a fixed sequence of steps." | yes | |
| "I'm writing an ETL pipeline." | yes | |
| "I want the compiler to verify every route is wired." | yes | |
| "I know the topology at authoring time and will not change it without rewriting." | yes | |
| "I'm loading the DAG from JSON or generating it from a template." | | yes |
| "I need the JSON-LD wire shape for cross-process transmission." | | yes |
| "I'm writing test fixtures and want zero indirection." | | yes |

## Capability matrix

Both authoring journeys can produce any DAG the schema allows. The differences are ergonomic.

| Capability | Raw `DAG` | DAGBuilder |
|---|---|---|
| `SingleNode` placement | yes | yes |
| `ScatterNode` placement | yes | yes via `.scatter()` |
| Gather strategy (`map` / `append` / `partition` / `custom` / `collect` / `discard`) | yes | yes via `options.gather` |
| Outcome reducer (`aggregate` / `all-success` / `any-success` / custom) | yes | yes via `options.reducer` |
| Scatter body variant (`node` or `dag`) | yes | yes via `body` argument |
| `EmbeddedDAGNode` placement | yes | yes via `.embeddedDAG()` |
| `TerminalNode` placement | yes | yes via `.terminal()` |
| `inputs` (parent → clone seed) | yes | yes via `options.inputs` |
| Multi-port routing | yes | yes via `routes` map |
| Compile-time route narrowing | | yes from `NodeInterface` `TOutput` |
| Runtime-conditional topology | yes (build conditionally) | yes (chain conditionally) |
| Recursive / trampoline flows | yes via `services.dispatcher.execute` | yes, same pattern in node body |

The last two rows are imperative patterns. A node that recursively dispatches a sub-DAG via `services.dispatcher.execute(name, state.clone())` is a trampoline; it lives in node logic regardless of which authoring journey produced the DAG.

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

Nodes never throw past the node boundary. An error condition is a **flow decision**: the node returns `NodeOutputBuilder.of('error', { errors: [...] })` and the DAG routes the `'error'` output to a recovery node or an error terminal. The engine does not intercept throws and reroute them.

This means every node that can fail must:
1. Declare `'error'` (or a domain-specific name like `'salvage'`) as one of its output ports.
2. Return `NodeOutputBuilder.of('error', ...)` when the failure condition is met.
3. Have that output wired to a downstream placement in the DAG.

```ts
// Correct: declare the error port, return it on failure
class FetchNode extends ScalarNode<MyState, 'success' | 'error'> {
  readonly name = 'fetch';
  readonly outputs = ['success', 'error'] as const;

  protected async executeOne(state: MyState, context: NodeContextType): Promise<NodeOutputType<'success' | 'error'>> {
    try {
      state.result = await fetchData(context.signal);
      return NodeOutputBuilder.of('success');
    } catch (err) {
      return NodeOutputBuilder.of('error', {
        errors: [NodeErrorBuilder.from('fetchFailed', String(err), 'fetch', false, new Date().toISOString())],
      });
    }
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

## Switching journeys mid-project

The output is the same JSON-LD `DAG`. A flow authored via DAGBuilder can be:

- Serialized via `DAGDocument.serialize(dag)` to JSON and reloaded later via `DAGDocument.load`.
- Rewritten as a raw `DAG` literal without changing the dispatcher contract.

There is no lock-in. The DAG object is the only API. Both journeys are ergonomic paths to it.

## When to drop down to raw `DAG`

The sugar layers exist for ergonomics. Drop down to raw `DAG` literals when:

- You're generating DAGs programmatically from a higher-level spec (a config file, a UI builder, a DSL).
- You're loading a DAG from persistent storage (file, database, message envelope).
- You're writing tests and want the fixture to be transparent.
- The sugar layer's invariants get in your way (rare; usually a sign the flow is misshapen).

Use `DAGDocument.load(jsonString)` to validate the raw shape at the ingest boundary; the engine refuses anything that does not match `DAGSchema`. See [JSON-LD export and import](./json-ld) for details.

## Related reference

- [Phase 02, DAGBuilder demo](../examples/02-builder)
- [Reference, Dagonizer](../reference/dagonizer)
- [Reference, Entities](../reference/entities)
