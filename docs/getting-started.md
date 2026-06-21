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

`@studnicky/dagonizer` lets you define multi-step workflows as a graph of typed nodes. Each node does one piece of work, returns a named output, and the dispatcher routes to the next node based on that output. Steps can depend on each other, run with shared typed state, retry on failure, cancel cleanly on abort, and pause and resume from a checkpoint — without your nodes knowing about any of that machinery.

A **DAG** (**D**irected **A**cyclic **G**raph) is the graph of steps. Think of it as a flowchart: each box is a node, each arrow is labelled with a named output, and the dispatcher follows the arrows at runtime.

From zero to a running DAG in three steps.

## Install

```bash
npm install @studnicky/dagonizer
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

## Fluent authoring with DAGBuilder

The example above uses the raw JSON-LD DAG definition directly, which is the canonical wire format. For day-to-day authoring, `DAGBuilder` (from `@studnicky/dagonizer/builder`) is the recommended path: it is a compile-checked fluent API that builds the same JSON-LD definition from typed method calls, catching unwired outputs and invalid routing at compile time before any schema validation runs.

```ts twoslash
import { DAGBuilder, NodeStateBase, ScalarNode, NodeOutputBuilder } from '@studnicky/dagonizer';
import type { SchemaObjectType } from '@studnicky/dagonizer';
// ---cut---
class CheckNode extends ScalarNode<NodeStateBase, 'ok' | 'fail'> {
  readonly name = 'check';
  readonly outputs = ['ok', 'fail'] as const;
  override get outputSchema(): Record<'ok' | 'fail', SchemaObjectType> {
    return { ok: { type: 'object' }, fail: { type: 'object' } };
  }
  protected override async executeOne(_state: NodeStateBase) {
    return NodeOutputBuilder.of<'ok' | 'fail'>('ok');
  }
}

const dag = new DAGBuilder('my-flow', '1')
  .node('check', new CheckNode(), { ok: 'end', fail: 'end' })
  .terminal('end')
  .build();
```

See the [DAGBuilder guide](/guide/builder) for the full API including scatter, embedded DAG, and phase placements.

## Next destination

Two in-browser demos show the same engine in different domains:

- [The Archivist](/examples/the-archivist) — LLM agents. A multi-stage bibliographic-assistant DAG that exercises scatter (over source arrays and sub-DAG bodies), retry, cancellation, and checkpoint resume.
- [The Cartographer](/examples/the-cartographer) — data orchestration / ETL / streaming. Multi-format satellite tracking feeds fanned through per-format ingest sub-DAGs with conditional routing, geo-resolution, GDPR redaction, and streaming backpressure. No LLM.
