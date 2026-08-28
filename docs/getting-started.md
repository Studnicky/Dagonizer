---
title: 'Getting Started'
description: 'Install Dagonizer, run the smallest executable DAG, and follow the same builder pattern into The Archivist, The Cartographer, and The Dispatcher.'
nextSteps:
  - text: 'The Archivist'
    link: '/examples/the-archivist'
    description: 'executable LLM-agent workflow'
  - text: 'The Cartographer'
    link: '/examples/the-cartographer'
    description: 'executable data-orchestration / ETL / streaming workflow'
  - text: 'Concepts'
    link: '/concepts'
    description: 'vocabulary for nodes, placements, lifecycle'
  - text: 'Architecture'
    link: '/architecture'
    description: 'node kinds, lifecycle FSM, execution model'
seeAlso:
  - text: 'The Archivist'
    link: './examples/the-archivist'
    description: 'executable LLM-agent workflow'
  - text: 'The Cartographer'
    link: './examples/the-cartographer'
    description: 'executable data-orchestration / ETL / streaming workflow'
  - text: 'Concepts'
    link: './concepts'
    description: 'vocabulary'
  - text: 'DAGBuilder'
    link: './guide/builder'
    description: 'fluent authoring API'
  - text: 'Example 02: DAGBuilder'
    link: './examples/02-builder'
    description: 'focused builder walkthrough'
  - text: 'Example 01: Linear DAG'
    link: './examples/01-linear'
    description: 'the same DAG, hand-written JSON-LD'
---

# Getting Started

## Quickstart Loop

Getting Started is the shortest honest path from install to a running Dagonizer flow. It uses the same two-node DAG that powers [Example 02: DAGBuilder](./examples/02-builder), then shows the JSON-LD shape it compiles to in [Example 01: Linear DAG](./examples/01-linear).

The quickstart follows one complete loop: install the package, define a tiny state object, build a DAG, register it, execute it, and inspect the result. The same execution model then scales into full-system examples, embedded DAGs, plugin-defined flows, scatter/gather, streaming producers, and checkpoint resume.

## Registration Model

Dagonizer splits a workflow into two things that are easy to reason about separately. The **DAG document** declares placement IRIs, entrypoints, and routes. The **registered nodes** contain the TypeScript behavior. The dispatcher joins them at runtime: it validates the graph, looks up registered nodes by their expanded IRI, runs the entrypoint placement, and follows the output route returned by each node.

That separation is the whole point. You can author with `DAGBuilder`, ship JSON-LD over the wire, render the shape as Mermaid, and still keep your actual work in normal TypeScript classes. The tiny example here is a classify/respond chain, but the same registration pattern powers The Archivist, The Cartographer, and The Dispatcher for real agent and data-pipeline flows. `DAGBuilder` is the authoring API; validated JSON-LD is the runtime document the engine loads and executes.

### What `execute` returns

`dispatcher.execute()` returns an `Execution<TState>` that is both awaitable and async-iterable.

Awaitable form:

<<< @/../examples/01-linear.ts#execute-await

Async-iterable form, one event per node:

<<< @/../examples/01-linear.ts#execute-iterable

## Minimal Flow

The first graph stays intentionally small: a start node routes to a response node, then the DAG ends. That keeps the execution shape visible: one placement emits an output token, the dispatcher follows the route, and the flow terminates at an explicit terminal.

```mermaid
flowchart LR
  classify[classify]
  respond[respond]
  done(((done)))
  classify -->|accepted| respond
  classify -->|rejected| done
  respond -->|success| done
```

The builder version and the JSON-LD version register the same topology: builder code is the ergonomic authoring API, JSON-LD is the canonical assembly, absolute placement IRIs are runtime identity, and Mermaid is the readable shape generated from that same assembly. Names stay for display and observability.

### Next Places To Open

Follow these pages in order if you want the quickstart to expand without changing concepts:

- [Example 02: DAGBuilder](./examples/02-builder) - the focused quickstart flow built with the same fluent builder API.
- [Example 01: Linear DAG](./examples/01-linear) - the same flow as direct JSON-LD.
- [The Archivist](./examples/the-archivist) - the same engine running an LLM-agent bookstore assistant.
- [The Cartographer](./examples/the-cartographer) - the same engine running streaming ETL with no LLM.

## What Expands Next

After this loop, the core execution model is in place: a DAG you can run, read, and modify. Scatter runs one body per source item. Gather joins producer IRIs at a visible barrier. Embedded DAGs invoke registered subflows. Plugins package reusable registered DAG parts. Checkpointing persists state and cursor when execution stops early.

It also gives you the right DevEx habit early: keep graph shape explicit. That matters for LLM agents, data science pipelines, ETL jobs, and service orchestration because reviewers can see the route map instead of reverse-engineering control flow from nested callbacks.

## Runnable Setup

### Install

```bash
npm install @studnicky/dagonizer
```

Requires Node.js 24 or later and TypeScript 5.6 or later with `strict: true`.

### Smallest DAG that runs

These focused examples come directly from the same runtime patterns the larger workflows use. The smallest executable DAG in that set is `examples/02-builder.ts`: a two-node chain that picks a route at the first node and ends at the second. It stays small on purpose, but it is still a real workflow rather than a placeholder topology.

`DAGBuilder` (from `@studnicky/dagonizer/builder`) is the recommended authoring API: a compile-checked fluent API that catches unwired outputs and invalid routing at compile time, before any schema validation runs. The same pattern scales directly into [The Archivist](/examples/the-archivist), [The Cartographer](/examples/the-cartographer), and [The Dispatcher](/examples/the-dispatcher), where the built DAGs are the canonical JSON-LD inputs consumed by the dispatcher.

The focused builder walkthrough lives in `examples/dags/02-builder.topology.ts` and `examples/02-builder.ts`.

State and nodes:

<<< @/../examples/dags/02-builder.topology.ts#imports

<<< @/../examples/dags/02-builder.topology.ts#nodes

The DAG definition, built via `DAGBuilder`:

<<< @/../examples/dags/02-builder.topology.ts#builder

Register, then execute:

<<< @/../examples/02-builder.ts#run

Run it directly:

```bash
npx tsx examples/02-builder.ts
```

See the [DAGBuilder guide](/guide/builder) for the full API including scatter, `.embed()`, and phase placements.

### The same DAG as JSON-LD

`DAGBuilder.build()` returns a plain JSON-LD document — the canonical wire format `DAGDocument.load(json)` accepts before `dispatcher.registerDAG(dag)` stores it. The DAG built above is identical, field for field, to this hand-written literal (from `examples/dags/01-linear.ts`, the same two-node classify/respond chain):

<<< @/../examples/dags/01-linear.ts#dag

Author the wire format directly for advanced use: hand-authored fixtures, interop with non-TypeScript tooling that emits or consumes JSON-LD, or understanding exactly what ships over the wire. Both forms register and execute identically:

<<< @/../examples/01-linear.ts#run

## Runtime Notes

The quickstart hides almost nothing. `DAGBuilder` is not a separate runtime; it produces the JSON-LD document the dispatcher already accepts. The dispatcher does not scan your module graph; it only runs nodes and DAGs you register. The graph is portable data, and the behavior stays in normal TypeScript classes.

This is closer to a small in-process workflow engine than to a prompt-chain helper. There is no external scheduler, no mandatory queue, and no invisible global registry. When you need those things, you compose them around Dagonizer: a web handler, a worker, Temporal, a database-backed checkpoint store, or a plugin package that exports reusable DAG IRIs.

### Next destination

Three reference workflows show the same engine in different domains:

- [The Archivist](/examples/the-archivist) — LLM agents. A multi-stage bibliographic-assistant DAG that exercises tool DAGs, embedded search bodies, retry, cancellation, and checkpoint resume.
- [The Cartographer](/examples/the-cartographer) — data orchestration / ETL / streaming. Multiple source entrypoints each run a feed/unpack/normalize DAG, converge through a canonical open gather, then scatter through typed event pipelines with conditional routing, geo-resolution, GDPR redaction, and streaming backpressure. No LLM.
- [The Dispatcher](/examples/the-dispatcher) — HITL support workflow. Customer messages route through routine AI response, operator escalation with park/resume, or off-topic decline.

## Related Concepts

Next references, based on what you want to build:

- [Concepts](./concepts) - the vocabulary behind nodes, placements, lifecycle, scatter, state, and checkpoints.
- [Architecture](./architecture) - how the dispatcher, lifecycle machine, validators, and public subpaths fit together.
- [DAGBuilder](./guide/builder) - the fluent authoring API used in the quickstart.
- [Example 02: DAGBuilder](./examples/02-builder) - focused quickstart flow built with the same builder API shown above.
- [The Archivist](./examples/the-archivist) - end-to-end workflow for agent memory, tools, retry, and response composition.
- [The Cartographer](./examples/the-cartographer) - end-to-end workflow for streaming data orchestration, scatter/gather, and plugin-style DAG parts.
