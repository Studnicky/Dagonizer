---
title: 'Authoring DAGs'
description: 'Dagonizer ships one DAG type — JSON-LD canonical, schema-validated, dispatcher-consumed — and three authoring journeys to produce it: raw DAG literals, DAGBuilder for deterministic workflows, and DAGDeriver for agentic flows. Pick the journey that matches the mental model you use to describe the flow.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'sugar for deterministic / ETL workflows'
  - text: 'Contract-derived flows (DAGDeriver)'
    link: './derive'
    description: 'sugar for agentic / tool-driven flows'
  - text: 'JSON-LD export & import'
    link: './json-ld'
    description: 'raw DAG literals via Dagonizer.serialize / Dagonizer.load'
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

The DAG type is the API. A `DAG` is a JSON-LD 1.1 document with `@context`, `@id`, `@type`, and a `nodes` array of placement objects. The dispatcher consumes it; the schema validates it; RDF tools read it natively. Everything else in Dagonizer's authoring story is **sugar** that produces this same canonical object.

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
              │  deterministic     │  │  agentic /      │
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

## ⦿ DAGBuilder — when you're in control

DAGBuilder is for **deterministic workflows you control end-to-end**. ETL pipelines, transformation chains, fixed sequences where the order IS the spec.

You think: *"first this, then that, then if X go here else go there."* TypeScript narrows the route map at each `.node()` call from the node's `TOutput` union — misspelled routes are compile errors before the DAG ever runs.

```ts
const dag = new DAGBuilder('user-onboarding')
  .node('validate-email', validateEmail, { 'valid': 'check-domain', 'invalid': null })
  .node('check-domain',   checkDomain,   { 'allowed': 'create-account', 'blocked': null })
  .node('create-account', createAccount, { 'success': null, 'duplicate': null })
  .build();
```

Choose DAGBuilder when:

- ⦿ The flow is a fixed pipeline. You add a stage by editing the chain.
- ⦿ Routes are unambiguous and you want them on the page next to the node reference.
- ⦿ You want the TypeScript compiler to verify every output is wired.
- ⦿ The flow is short-lived authoring (one-off composition, generated from a template, etc.).

## ⦿ DAGDeriver — when the topology should emerge

DAGDeriver is for **agentic flows where reaching the final state matters more than authoring the order**. Tool-driven agents, exploratory pipelines, workflows where the operation set changes per deployment, systems where adding a capability is one new contract and the topology rewires itself.

You think: *"these operations declare what they need and what they produce; the system figures out the order."* Adding a new operation is a one-line registration; the data graph (`produces ↔ hardRequired`) derives the edges.

```ts
const dag = DAGDeriver.derive({
  name:       'research-agent',
  version:    '1',
  entrypoint: 'classify-intent',
  contracts: [
    { name: 'classify-intent', hardRequired: ['query'],          produces: ['intent'],     outputs: ['lookup', 'similar', 'off-topic'] },
    { name: 'fetch-candidates', hardRequired: ['intent'],         produces: ['candidates'], outputs: ['success', 'empty'] },
    { name: 'rank',            hardRequired: ['candidates'],     produces: ['shortlist'],  outputs: ['success'] },
    { name: 'compose',         hardRequired: ['shortlist'],      produces: ['response'],   outputs: ['success', 'retry'] },
  ],
  annotations: {
    terminals: { 'classify-intent': [{ outcome: 'off-topic', target: null }] },
  },
});
```

Add a new candidate source? Write one contract; the topology rewires automatically. The author cares about the operation set, not the order.

Choose DAGDeriver when:

- ⦿ The flow is a registry of tools / capabilities. Adding one should auto-wire it.
- ⦿ Different deployments compose different subsets of operations.
- ⦿ The author thinks in terms of data dependencies, not control flow.
- ⦿ The flow is long-lived; topology may evolve.

## ⦿ Raw `DAG` literals — always available

Both sugar layers produce the same `DAG` object. You can also write one directly — useful for code generation, JSON loaded from disk, fixture data in tests, or programmatic composition.

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const dag = Dagonizer.load(await fs.readFile('dag.json', 'utf8'));
dispatcher.registerDAG(dag);
```

See [JSON-LD export and import](./json-ld) for the canonical shape, round-trip semantics, and persistence patterns.

## ⦿ Decision matrix

| Question | DAGBuilder | DAGDeriver | Raw `DAG` |
|---|---|---|---|
| "I have a fixed sequence of steps." | ✓ | | |
| "I'm writing an ETL pipeline." | ✓ | | |
| "I want the compiler to verify every route is wired." | ✓ | | |
| "I know the topology at authoring time and won't change it without rewriting." | ✓ | | |
| "I'm building an agent / assistant / tool-driven workflow." | | ✓ | |
| "Adding a new operation should auto-rewire the flow." | | ✓ | |
| "Operations are tools — they declare what they need and what they produce." | | ✓ | |
| "I care about reaching some final state; the order can fall out." | | ✓ | |
| "Different deployments may compose different subsets of operations." | | ✓ | |
| "I'm loading the DAG from JSON or generating it from a template." | | | ✓ |
| "I need the JSON-LD wire shape for cross-process transmission." | | | ✓ |
| "I'm writing test fixtures and want zero indirection." | | | ✓ |

## ⦿ Capability matrix

All three authoring journeys can produce any DAG the schema allows. The differences are ergonomic.

| Capability | Raw `DAG` | DAGBuilder | DAGDeriver |
|---|---|---|---|
| `SingleNode` placement | ✓ | ✓ | ✓ |
| `ParallelNode` placement | ✓ | ✓ explicit | ✓ auto-grouped + `DAGDeriverParallel` for explicit |
| Combine strategy (`all-success`/`any-success`/`collect`) | ✓ | ✓ | ✓ via `DAGDeriverParallel.combine` |
| `FanOutNode` placement | ✓ | ✓ | ✓ |
| Fan-in strategy (`custom`/`partition`/`append`) | ✓ | ✓ | ✓ via `DAGDeriverFanOut.strategy` |
| Fan-out item kind (`node` or `dag`) | ✓ | ✓ via `.fanOut()` / `.deepDAG()` | ✓ via `DAGDeriverFanOut.node \| dag` |
| `DeepDAGNode` placement | ✓ | ✓ | ✓ via `DAGDeriverAnnotations.subDAGs` |
| `stateMapping` | ✓ | ✓ | ✓ |
| Multi-port routing | ✓ | ✓ via `routes` map | ✓ via `contract.outputs` + `terminals` |
| Compile-time route narrowing | | ✓ from `NodeInterface` `TOutput` | (n/a — declarative) |
| Topology derivation from data graph | | (n/a — imperative) | ✓ from `produces ↔ hardRequired` |
| Runtime-conditional topology | ✓ build conditionally | ✓ chain conditionally | partial (contracts at runtime, annotations static) |
| Recursive / trampoline flows | ✓ node dispatches sub-DAG via `services.dispatcher.execute` | ✓ same pattern in node body | not a declarative target — use DAGBuilder |

The bottom two rows are genuinely imperative patterns. A node that recursively dispatches a sub-DAG via `services.dispatcher.execute(name, state.clone())` is a trampoline; it lives in node logic regardless of which authoring journey produced the DAG. DAGDeriver doesn't try to absorb these patterns into annotations.

## ⦿ Switching journeys mid-project

The output is the same JSON-LD `DAG`. A flow authored via DAGBuilder can be:

- ⦿ Serialized via `Dagonizer.serialize(dag)` to JSON and reloaded later via `Dagonizer.load`.
- ⦿ Compared against a DAGDeriver-derived DAG of the same flow (they'll match modulo `@id` URN choices).
- ⦿ Rewritten in the other authoring journey without changing the dispatcher contract.

There's no "lock-in" — the DAG object is the only API. The journeys are alternate ergonomic paths to it.

## ⦿ When to drop down to raw `DAG`

The sugar layers exist for ergonomics. Drop down to raw `DAG` literals when:

- ⦿ You're generating DAGs programmatically from a higher-level spec (a config file, a UI builder, a DSL).
- ⦿ You're loading a DAG from persistent storage (file, database, message envelope).
- ⦿ You're writing tests and want the fixture to be transparent.
- ⦿ The sugar layer's invariants get in your way (rare; usually a sign the flow is misshapen).

Use `Dagonizer.load(jsonString)` to validate the raw shape at the ingest boundary; the engine refuses anything that doesn't match `DAGSchema`. See [JSON-LD export and import](./json-ld) for details.
