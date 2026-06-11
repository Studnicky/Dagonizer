---
title: 'Authoring DAGs'
description: 'Dagonizer ships one DAG type (JSON-LD canonical, schema-validated, dispatcher-consumed) and three authoring journeys to produce it: raw DAG literals, DAGBuilder for deterministic workflows, and DAGDeriver for agentic flows. Pick the journey that matches the mental model you use to describe the flow.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'sugar for deterministic, ETL-shaped workflows'
  - text: 'Contract-derived flows (DAGDeriver)'
    link: './derive'
    description: 'sugar for agentic, tool-driven flows'
  - text: 'JSON-LD export and import'
    link: './json-ld'
    description: 'raw DAG literals via Dagonizer.serialize and Dagonizer.load'
  - text: 'Concepts'
    link: '../concepts'
    description: 'the DAG type itself and its placement vocabulary'
nextSteps:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'imperative authoring'
  - text: 'DAGDeriver'
    link: './derive'
    description: 'declarative authoring from contract registries'
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
              │     DAGBuilder     │  │   DAGDeriver    │
              │                    │  │                 │
              │  Sugar for         │  │  Sugar for      │
              │  deterministic     │  │  agentic,       │
              │  workflows         │  │  contract-      │
              │                    │  │  driven flows   │
              └────────────────────┘  └─────────────────┘
                          ▲                  ▲
                          │                  │
                          └────── plus ──────┘
                          raw `DAG` literals
                          (always available)
```

Three authoring journeys, one API. Pick the journey that matches how you describe the flow to another engineer.

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

## DAGDeriver when the topology should emerge

DAGDeriver is for agentic flows where reaching the final state matters more than authoring the order. Tool-driven agents, exploratory pipelines, workflows where the operation set changes per deployment, systems where adding a capability is one new contract and the topology rewires itself.

The mental model: *these operations declare what they need and what they produce; the system figures out the order.* Adding a new operation is a one-line registration; the data graph (`produces` paired with `hardRequired`) derives the edges.

```ts
import { NodeOutputBuilder, DAGDeriver } from '@noocodex/dagonizer';

const classifyIntent = {
  name: 'classify-intent',
  outputs: ['lookup', 'similar', 'off-topic'] as const,
  contract: { hardRequired: ['query'] as const, produces: ['intent'] as const },
  async execute(state) { return NodeOutputBuilder.of('lookup'); },
};
const fetchCandidates = {
  name: 'fetch-candidates',
  outputs: ['success', 'empty'] as const,
  contract: { hardRequired: ['intent'] as const, produces: ['candidates'] as const },
  async execute(state) { return NodeOutputBuilder.of('success'); },
};
const rank = {
  name: 'rank',
  outputs: ['success'] as const,
  contract: { hardRequired: ['candidates'] as const, produces: ['shortlist'] as const },
  async execute(state) { return NodeOutputBuilder.of('success'); },
};
const compose = {
  name: 'compose',
  outputs: ['success', 'retry'] as const,
  contract: { hardRequired: ['shortlist'] as const, produces: ['response'] as const },
  async execute(state) { return NodeOutputBuilder.of('success'); },
};

const dag = DAGDeriver.derive({
  name:       'research-agent',
  version:    '1',
  entrypoint: 'classify-intent',
  nodes: [classifyIntent, fetchCandidates, rank, compose],
  annotations: {
    terminals: { 'classify-intent': [{ outcome: 'off-topic', target: 'compose' }] },
  },
});
```

Add a new candidate source: write one contract, the topology rewires automatically. The author cares about the operation set, not the order.

Choose DAGDeriver when:

- The flow is a registry of tools or capabilities. Adding one should auto-wire it.
- Different deployments compose different subsets of operations.
- The author thinks in terms of data dependencies, not control flow.
- The flow is long-lived; topology may evolve.

## Raw `DAG` literals, always available

Both sugar layers produce the same `DAG` object. A literal can also be written directly: useful for code generation, JSON loaded from disk, fixture data in tests, or programmatic composition.

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const dag = Dagonizer.load(await fs.readFile('dag.json', 'utf8'));
dispatcher.registerDAG(dag);
```

See [JSON-LD export and import](./json-ld) for the canonical shape, round-trip semantics, and persistence patterns.

## Node implementations sit beside authoring

Authoring decides topology; node implementations carry the work. `NodeInterface<TState, TOutput, TServices>` is the contract every node satisfies. The classify-intent node from the Archivist demo declares a seven-value `TOutput` union and routes via `switch`:

<<< @/../examples/the-archivist/nodes/classifyIntent.ts#node-class

The same `classifyIntent` reference is registered with the dispatcher and referenced by name from a placement in the DAG. The authoring surface decides where in the topology this node sits; the node implementation decides what it does and which output it returns.

## Decision matrix

| Question | DAGBuilder | DAGDeriver | Raw `DAG` |
|---|---|---|---|
| "I have a fixed sequence of steps." | yes | | |
| "I'm writing an ETL pipeline." | yes | | |
| "I want the compiler to verify every route is wired." | yes | | |
| "I know the topology at authoring time and will not change it without rewriting." | yes | | |
| "I'm building an agent, assistant, or tool-driven workflow." | | yes | |
| "Adding a new operation should auto-rewire the flow." | | yes | |
| "Operations are tools: they declare what they need and what they produce." | | yes | |
| "I care about reaching some final state; the order can fall out." | | yes | |
| "Different deployments may compose different subsets of operations." | | yes | |
| "I'm loading the DAG from JSON or generating it from a template." | | | yes |
| "I need the JSON-LD wire shape for cross-process transmission." | | | yes |
| "I'm writing test fixtures and want zero indirection." | | | yes |

## Capability matrix

All three authoring journeys can produce any DAG the schema allows. The differences are ergonomic.

| Capability | Raw `DAG` | DAGBuilder | DAGDeriver |
|---|---|---|---|
| `SingleNode` placement | yes | yes | yes |
| `ScatterNode` placement | yes | yes via `.scatter()` | yes via `DAGDeriverAnnotations.scatters` (node body) |
| Gather strategy (`map` / `append` / `partition` / `custom` / `collect` / `discard`) | yes | yes via `options.gather` | yes via `DAGDeriverScatter.strategy` |
| Outcome reducer (`aggregate` / `all-success` / `any-success` / custom) | yes | yes via `options.reducer` | (via scatter scatter outcomes) |
| Scatter body kind (`node` or `dag`) | yes | yes via `body` argument | node body via `DAGDeriverScatter`; dag body via `embeddedDAGs` or raw `DAG` |
| `EmbeddedDAGNode` placement | yes | yes via `.embeddedDAG()` | yes via `DAGDeriverAnnotations.embeddedDAGs` |
| `TerminalNode` placement | yes | yes via `.terminal()` | (not a target, use DAGBuilder) |
| `inputs` (parent → clone seed) | yes | yes via `options.inputs` | yes via `DAGDeriverScatter` |
| Multi-port routing | yes | yes via `routes` map | yes via `contract.outputs` and `terminals` |
| Compile-time route narrowing | | yes from `NodeInterface` `TOutput` | (not applicable, declarative) |
| Topology derivation from data graph | | (not applicable, imperative) | yes from `produces` plus `hardRequired` |
| Runtime-conditional topology | yes (build conditionally) | yes (chain conditionally) | partial (contracts at runtime, annotations static) |
| Recursive / trampoline flows | yes via `services.dispatcher.execute` | yes, same pattern in node body | not a declarative target, use DAGBuilder |

The bottom two rows are imperative patterns. A node that recursively dispatches a sub-DAG via `services.dispatcher.execute(name, state.clone())` is a trampoline; it lives in node logic regardless of which authoring journey produced the DAG. DAGDeriver does not absorb these patterns into annotations.

## Terminal placements

Every DAG branch must end at a named `TerminalNode` placement. Declare one with `.terminal(name, options?)`:

```ts
.node('finalize', finalizeNode, { success: 'end' })
.terminal('end')
```

`.terminal(name, options?)` emits a `TerminalNode` placement. When the engine reaches it, the flow ends with the declared `outcome` (`'completed'` by default). To mark a branch as `failed`, pass `{ outcome: 'failed' }`:

```ts
.node('check', checkNode, { pass: 'end-ok', fail: 'end-fail' })
.terminal('end-ok')
.terminal('end-fail', { outcome: 'failed' })
```

Named terminals appear as discrete nodes in the visualisation. Use descriptive names (`end-ok`, `response-sent`, `workflow-failed`) when the endpoint name carries meaning.

An `EmbeddedDAGNode` placement targets named terminals directly. This is the idiomatic way to surface a child DAG's error as a `failed` lifecycle in the parent:

```ts
.embeddedDAG('run-child', 'child-dag', { success: 'end-ok', error: 'end-fail' })
.terminal('end-ok')
.terminal('end-fail', { outcome: 'failed' })
```

See [DAGBuilder, `.terminal()`](./builder#terminal-name-outcome) and [Phase 09, Terminal placements](../examples/09-terminals) for runnable examples.

## Switching journeys mid-project

The output is the same JSON-LD `DAG`. A flow authored via DAGBuilder can be:

- Serialized via `Dagonizer.serialize(dag)` to JSON and reloaded later via `Dagonizer.load`.
- Compared against a DAGDeriver-derived DAG of the same flow (they match modulo `@id` URN choices).
- Rewritten in the other authoring journey without changing the dispatcher contract.

There is no lock-in. The DAG object is the only API. The journeys are alternate ergonomic paths to it.

## When to drop down to raw `DAG`

The sugar layers exist for ergonomics. Drop down to raw `DAG` literals when:

- You're generating DAGs programmatically from a higher-level spec (a config file, a UI builder, a DSL).
- You're loading a DAG from persistent storage (file, database, message envelope).
- You're writing tests and want the fixture to be transparent.
- The sugar layer's invariants get in your way (rare; usually a sign the flow is misshapen).

Use `Dagonizer.load(jsonString)` to validate the raw shape at the ingest boundary; the engine refuses anything that does not match `DAGSchema`. See [JSON-LD export and import](./json-ld) for details.

## Related reference

- [Phase 02, DAGBuilder demo](../examples/02-builder)
- [Reference, Dagonizer](../reference/dagonizer)
- [Reference, Entities](../reference/entities)
