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
  - text: 'Example 02: DAGBuilder'
    link: './examples/02-builder'
    description: 'the source file used below'
  - text: 'Example 01: Linear DAG'
    link: './examples/01-linear'
    description: 'the same DAG, hand-written JSON-LD'
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

A two-node chain that picks a route at the first node and ends at the second. `DAGBuilder` (from `@studnicky/dagonizer/builder`) is the recommended way to author it: a compile-checked fluent API that catches unwired outputs and invalid routing at compile time, before any schema validation runs. At a glance:

```ts twoslash
import { Batch, DAGBuilder, MonadicNode, NodeStateBase, RoutedBatch } from '@studnicky/dagonizer';
import type { NodeContextType, SchemaObjectType } from '@studnicky/dagonizer';
// ---cut---
class CheckNode extends MonadicNode<NodeStateBase, 'ok' | 'fail'> {
  readonly name = 'check';
  readonly outputs: readonly ('ok' | 'fail')[] = ['ok', 'fail'];
  override get outputSchema(): Record<'ok' | 'fail', SchemaObjectType> {
    return { ok: { type: 'object' }, fail: { type: 'object' } };
  }
  async execute(batch: Batch<NodeStateBase>, context: NodeContextType) {
    if (context.signal.aborted) return RoutedBatch.create('fail', batch);
    return RoutedBatch.create('ok', batch);
  }
}

const dag = new DAGBuilder('my-flow', '1')
  .node('check', new CheckNode(), { ok: 'end', fail: 'end' })
  .terminal('end')
  .build();
```

The full walkthrough: the source ships in the repo as `examples/dags/02-builder.topology.ts` and `examples/02-builder.ts`.

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

See the [DAGBuilder guide](/guide/builder) for the full API including scatter, embedded DAG, and phase placements.

## What this compiles to: JSON-LD

`DAGBuilder.build()` returns a plain JSON-LD document — the canonical wire format `dispatcher.registerDAG(dag)` accepts. The DAG built above is identical, field for field, to this hand-written literal (from `examples/dags/01-linear.ts`, the same two-node classify/respond chain):

<<< @/../examples/dags/01-linear.ts#dag

Author the wire format directly for advanced use: hand-authored fixtures, interop with non-TypeScript tooling that emits or consumes JSON-LD, or understanding exactly what ships over the wire. Both forms register and execute identically:

<<< @/../examples/01-linear.ts#run

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
