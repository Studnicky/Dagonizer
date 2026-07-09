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

<script setup lang="ts">
import { dag as builderDag } from '../../examples/dags/02-builder.topology.ts';
</script>

# Authoring DAGs

## What It Is

Dagonizer has one workflow artifact: a schema-validated JSON-LD `DAG` document. You can create it with `DAGBuilder`, load it from serialized JSON-LD, or receive it from a plugin bundle. After that, it is the same object: the dispatcher registers it by expanded DAG IRI, the visualizers render it, and validators check it.

That makes authoring a topology decision, not a framework fork. Choose the most convenient source form for your application, then let everything converge on the canonical DAG document.

## How It Works

Authoring produces one object: a schema-valid `DAG`. `DAGBuilder` is the typed factory for that object; JSON loading is the ingest path for the same object; plugin registration installs the same object into the registry. The dispatcher does not care which authoring path produced it.

The `DAG` type is the API. A `DAG` is a JSON-LD 1.1 document with `@context`, `@id`, `@type`, and a `nodes` array of placement objects. The DAG `@id` is the identity the registry expands and stores. Each placement `@id` is the routing target inside the graph. The `name` fields stay useful for diagrams, logs, and watchers in the deep, but they are not the source of execution identity.

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

## Diagrams, Examples, and Outputs

Example 02 builds a small `chat` DAG in TypeScript and registers the resulting JSON-LD object. The code and diagram below are generated from the same runnable source file:

<<< @/../examples/dags/02-builder.topology.ts#builder

<DagJsonMermaid :dag="builderDag" title="Example 02 builder DAG" aria-label="Example 02 JSON-LD DAG beside Mermaid generated from it." />

Use the runnable pages for execution output:

- [Example 02: DAGBuilder](../examples/02-builder) shows the builder source, JSON-LD DAG, Mermaid view, and run output.
- [Example 03: Tool Schemas](../examples/03-schema) loads a DAG from a JSON-LD string and round-trips it through validation.
- [The Archivist](../examples/the-archivist) is a full browser demo whose parent DAG and embedded DAGs are authored with `DAGBuilder`.
- [The Cartographer](../examples/the-cartographer) shows DAG authoring across worker-bound scatter, embedded compliance checks, and pipeline delivery flows.

## What It Lets You Do

### Use when

Use this guide when deciding whether to author a DAG in TypeScript with `DAGBuilder`, load a serialized JSON-LD document, or package a child flow for embedding or plugin registration. The application decision is not "builder versus JSON-LD runtime"; both produce the same canonical DAG document.

## Code Samples

### Error-routing contract

Nodes never throw past the node boundary. An error condition is a **flow decision**: the node returns the failed items on an `'error'` routed sub-batch and the DAG routes that output to a recovery node or an error terminal. The engine does not intercept throws and reroute them.

This means every node that can fail must:
1. Declare `'error'` (or a domain-specific name like `'salvage'`) as one of its output ports.
2. Return a routed sub-batch on `'error'` when the failure condition is met.
3. Have that output wired to a downstream placement in the DAG.

The Cartographer demonstrates this contract in runnable code. `route-redaction`
does not throw when redaction is unnecessary; it routes either to
`needs-redaction` or `skip-redaction` and lets the DAG decide which path runs:

<<< @/../examples/the-cartographer/nodes/routeRedaction.ts#route-redaction-node

The reusable `gdpr-compliance` sub-DAG makes terminal outcome part of topology:
`compliant` is a completed terminal and `violation` is a failed terminal. Parent
placements route the embedded DAG's `success` and `error` outputs explicitly:

<<< @/../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts#gdpr-compliance-dag

<<< @/../examples/the-cartographer/dag.ts#event-pipeline-typed-dag

If a node truly throws (an unexpected bug, not a handled error condition), the exception propagates as an engine-level failure and the lifecycle transitions to `failed`. This is distinct from routing to an `'error'` port, which is a deliberate flow decision the DAG topology controls.

## Details for Nerds

### DAGBuilder Is The Code Factory

DAGBuilder is the factory for DAG documents in TypeScript. ETL pipelines, transformation chains, agent loops, embedded DAGs, scatter bodies, tool DAGs, plugin DAGs, dynamic DAG references, and fixed sequences use the same fluent surface.

The mental model: *first this, then that, then if X go here else go there.* TypeScript narrows the route map at each `.node()` call from the node's `TOutput` union, so misspelled routes are compile errors before the DAG ever runs.

The builder example registers two nodes and chains them:

<<< @/../examples/dags/02-builder.topology.ts#builder

Use DAGBuilder because:

- A new stage is one more `.node()` link in the chain.
- Routes stay on the page next to the node reference.
- The TypeScript compiler verifies every output is wired.
- `.build()` returns the canonical JSON-LD `DAG` document the dispatcher consumes.

### JSON-LD Documents

<<< @/../examples/dags/03-schema.ts#load

Serialized DAGs are JSON-LD documents. Load them with `DAGDocument.load(json)` at process boundaries and persist them with `DAGDocument.serialize(dag)`. That is transport and storage for the same DAG object, not a second framework abstraction.

### Node implementations sit beside authoring

Authoring decides topology; node implementations carry the work. `NodeInterface<TState, TOutput>` is the contract every node satisfies. The classify-intent node from the Archivist demo declares a seven-value `TOutput` union and routes via `switch`:

<<< @/../examples/the-archivist/nodes/classifyIntent.ts#node-class

The same `classifyIntent` implementation is registered with the dispatcher and referenced from a placement in the DAG. The placement `@id` decides where the implementation sits in topology; `name` is the label humans see while the watcher lanterns are lit.

### Capability Matrix

DAGBuilder emits every placement shape the schema allows.

| Capability | DAGBuilder |
|---|---|
| `SingleNode` placement | yes via `.node()` |
| `ScatterNode` placement | yes via `.scatter()` |
| `GatherNode` placement | yes via `.gather()` |
| Gather strategy (`map` / `append` / `partition` / `custom` / `collect` / `discard`) | yes via `.gather(..., gatherConfig, ...)` |
| Outcome reducer (`aggregate` / `all-success` / `any-success` / custom) | yes via `options.reducer` |
| Scatter body variant (`node`, literal `dag`, or dynamic `DagReference`) | yes via `body` argument |
| `EmbeddedDAGNode` placement | yes via `.embed()` |
| `TerminalNode` placement | yes via `.terminal()` |
| `inputs` (parent -> clone seed) | yes via `options.inputs` |
| Multi-port routing | yes via `routes` map |
| Compile-time route narrowing | yes from `NodeInterface` `TOutput` |
| Runtime-conditional topology | yes by conditionally adding placements before `.build()` |
| Recursive / trampoline flows | yes via `DagReference` over registered DAG IRIs |

A node can still invoke the dispatcher directly when a host deliberately owns that trampoline, but the DAG-native composition surface is `DagReference`: the graph names its candidate DAG IRIs and the engine resolves the selected child at the invocation point.

### Terminal placements

Every DAG branch must end at an explicit `TerminalNode` placement IRI. Declare one with `.terminal(placementIri, options?)`:

<<< @/../examples/dags/09-terminals.ts#terminal-completed

`.terminal(name, options?)` emits a `TerminalNode` placement. When the engine reaches it, the flow ends with the declared `outcome` (`'completed'` by default). To mark a branch as `failed`, pass `{ outcome: 'failed' }`:

<<< @/../examples/dags/09-terminals.ts#terminal-failed

Terminals appear as discrete nodes in the visualisation. Use descriptive display names (`end-ok`, `response-sent`, `workflow-failed`) when the endpoint label carries meaning; route to the terminal placement IRI.

An `EmbeddedDAGNode` placement targets terminal placement IRIs directly. This is the idiomatic way to surface a child DAG's error as a `failed` lifecycle in the parent:

<<< @/../examples/dags/09-terminals.ts#embedded-terminals

See [DAGBuilder, `.terminal()`](./builder#terminal-name-outcome) and [Example 09: Terminal Nodes](../examples/09-terminals) for runnable examples.

### Loading JSON-LD

Use `DAGDocument.load(jsonString)` to validate a serialized DAG at the ingest boundary; the engine refuses anything that does not match `DAGSchema`. See [JSON-LD export and import](./json-ld) for details.

## Related Concepts

- [DAGBuilder](./builder) - chainable authoring API for deterministic workflows
- [JSON-LD export and import](./json-ld) - DAGDocument.serialize and DAGDocument.load
- [Concepts](../concepts) - the DAG type itself and its placement vocabulary
- [Example 02: DAGBuilder](../examples/02-builder)
- [Reference, Dagonizer](../reference/dagonizer)
- [Reference, Entities](../reference/entities)
