---
nextSteps:
  - text: 'The Archivist demo'
    link: '/examples/the-archivist'
    description: 'LLM-agent DAG running live in the browser'
  - text: 'The Cartographer demo'
    link: '/examples/the-cartographer'
    description: 'data-orchestration / ETL / streaming DAG running live in the browser'
  - text: 'Concepts'
    link: '/concepts'
    description: 'vocabulary for nodes, placements, lifecycle'
  - text: 'Architecture'
    link: '/architecture'
    description: 'node kinds, lifecycle FSM, execution model'
seeAlso:
  - text: 'The Archivist demo'
    link: './examples/the-archivist'
    description: 'LLM-agent live in-browser DAG'
  - text: 'The Cartographer demo'
    link: './examples/the-cartographer'
    description: 'data-orchestration / ETL / streaming live in-browser DAG'
  - text: 'Concepts'
    link: './concepts'
    description: 'vocabulary'
  - text: 'DAGBuilder'
    link: './guide/builder'
    description: 'fluent authoring API'
  - text: 'Example 01: Linear DAG'
    link: './examples/01-linear'
    description: 'the source file used below'
---

# Getting Started

From zero to a running DAG in three steps.

## Install

```bash
npm install @noocodex/dagonizer
```

Requires Node.js 24 or later and TypeScript 5.6 or later with `strict: true`.

## Smallest DAG that runs

A two-node chain that picks a route at the first node and ends at the second. The source ships in the repo as `examples/01-linear.ts`.

State and nodes:

<<< @/../examples/dags/01-linear.ts#state

<<< @/../examples/dags/01-linear.ts#node

The DAG definition (JSON-LD canonical form):

<<< @/../examples/dags/01-linear.ts#dag

Register, then execute:

<<< @/../examples/01-linear.ts#run

Run it directly:

```bash
npx tsx examples/01-linear.ts
```

## What `execute` returns

`dispatcher.execute()` returns an `Execution<TState>` that is both awaitable and async-iterable.

Awaitable form:

<<< @/../examples/01-linear.ts#execute-await

Async-iterable form, one event per node:

<<< @/../examples/01-linear.ts#execute-iterable

## Next destination

Two in-browser demos show the same engine in different domains:

- [The Archivist](/examples/the-archivist) — LLM agents. A multi-stage bibliographic-assistant DAG that exercises scatter (over source arrays and sub-DAG bodies), retry, cancellation, and checkpoint resume.
- [The Cartographer](/examples/the-cartographer) — data orchestration / ETL / streaming. Multi-format satellite tracking feeds fanned through per-format ingest sub-DAGs with conditional routing, geo-resolution, GDPR redaction, and streaming backpressure. No LLM.
