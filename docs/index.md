---
layout: doc
aside: false
title: Dagonizer
description: 'TypeScript DAG runtime for LLM agents and data pipelines: typed nodes, JSON-LD DAGs, streaming, checkpoint resume, plugins, and reference workflows.'
hero:
  name: Dagonizer
  text: TypeScript DAG runtime
  tagline: 'Author JSON-LD workflows, register typed nodes, execute with retries and checkpoints, and inspect the same graph in guides, live examples, and tooling.'
  image:
    src: /dagonizer-icon.svg
    alt: Dagonizer
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Architecture
      link: /architecture
    - theme: alt
      text: GitHub
      link: https://github.com/Studnicky/Dagonizer

features:
  - icon: λ
    title: Type-Safe Nodes
    details: 'Output types narrow the routing map at compile time. An unwired output is a TypeScript error before registerDAG confirms it at runtime.'
  - icon: ⊘
    title: Abortable Execution
    details: 'Pass a caller-controlled AbortSignal or a deadlineMs hard limit. The dispatcher composes them and propagates cancellation through every in-flight operation and every scatter clone.'
  - icon: ↻
    title: Deterministic Resume
    details: 'Snapshot a paused DAG at its cursor. Serialize to JSON, store anywhere, restore and resume with a new Execution that picks up where it left off.'
  - icon: ⬡
    title: Scatter + Gather Composition
    details: 'Scatter fans work out to registered nodes or DAG bodies. First-class GatherNode placements join producers back together by placement/entrypoint IRI, then route on explicit fan-in policy. Forks and joins stay visible in JSON-LD and Mermaid.'
  - icon: ⫴
    title: Streaming & Backpressure
    details: 'ScatterNode accepts an AsyncIterable or AsyncGenerator as its source — a stream drains through the same bounded worker pool as a finite array. concurrency IS the backpressure: the engine pulls the next item only when a worker frees. Resume is durable via an inbox queue: un-acked items reprocess on restart; the stream is never re-read from the beginning. Separately, every LlmAdapterInterface implements chatStream(request, sink) so a CallModelNode can push live per-token deltas to an observation sink while the assembled response still lands in state through the normal path.'
  - icon: ✕
    title: Retry Policies
    details: 'RetryPolicy provides constant, linear, exponential, and decorrelated-jitter strategies. Filter by error type. Cooperates with the abort signal so retries stop on cancellation.'
  - icon: ⊨
    title: JSON-LD Canonical Wire Format
    details: 'DAGBuilder produces the JSON-LD document the runtime consumes. Explicit DAG IRIs and placement IRIs are identity; display names are for humans, logs, and diagrams. DAGDocument.load(json) validates the wire shape before registration.'
  - icon: ◉
    title: Observability Hooks
    details: 'Subclass Dagonizer and override onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError, onPhaseEnter, and onPhaseExit for structured metrics, tracing, and audit trails.'
  - icon: ⏱
    title: Deterministic Testing
    details: 'VirtualClockProvider and VirtualScheduler replace platform timers in tests. Step through retry delays and deadlines with scheduler.advance(ms).'
---

# Dagonizer

## ⦿ What problem it solves

When work has multiple steps that depend on each other — classify, then fetch, then compose, then save — you need a way to express those dependencies, track shared state as work moves through them, stop safely when something goes wrong, and pick up where you left off if the process crashes. `@studnicky/dagonizer` is that infrastructure. You declare each step as a typed node, place those nodes inside a JSON-LD DAG, and register the DAGs and nodes the dispatcher may run. The dispatcher follows placement IRIs, routes by typed outputs, and handles retries, cancellation, and checkpoint/resume without your nodes carrying orchestration code.

A **DAG** is therefore a graph of placements where each placement's output drives the routing decision for the next placement. In plain terms, it is a flowchart where each box is a typed function or registered sub-DAG, the arrows are labeled outcomes, and every box has a canonical IRI under the hood. The eye of the graph is the IRI; the display name is just the label etched on the box.

## ⦿ One runtime across workflow domains

`@studnicky/dagonizer` is a single type-safe, resumable, abortable DAG/workflow engine. LLM-agent orchestration and data-orchestration / ETL run on the identical core; only the node domain differs. Three reference workflows show that runtime in different operating conditions: **The Archivist** (LLM agents — a bibliographic assistant), **The Dispatcher** (LLM agents with a human in the loop — warm-handoff support), and **The Cartographer** (streaming multi-format tracking feeds, geo-resolution, GDPR redaction, continent-level insights — no LLM).

## ⦿ What it is

A **node** is a typed, stateless unit of work that receives a batch of state items and a context (including an `AbortSignal`) and returns a routed batch — each item mapped to a named output port. Nodes receive external dependencies through their constructors. The dispatcher routes items to the next placement based on the output port. Extend `MonadicNode<TState, TOutput>` or implement `NodeInterface<TState, TOutput>` directly; per-item behavior lives inside the node's own `execute(batch, context)` loop. Six placement kinds cover the composition space.

| Kind | What it does |
|------|-------------|
| `single` | One registered node; output name selects the next placement IRI |
| `scatter` | Isolate one state clone per source item, run a registered node or DAG body in each clone, and emit per-item records for downstream fan-in |
| `gather` | Join records from producer placement or entrypoint IRIs, apply a gather strategy, and route when the fan-in policy is satisfied |
| `embedded` | Invoke a registered sub-DAG exactly once (cardinality 1) in an isolated state; optional `stateMapping` seeds the child and copies fields back; route on the child's terminal outcome |
| `terminal` | Named end state for explicit completion or failure; use when a flow has more than one "done" semantics |
| `phase` | Lifecycle-attached single-node placement: `pre` runs before the entrypoint, `post` runs after the main loop drains on every exit path |

## ⦿ FSM-driven lifecycle

Every execution runs through `DAGLifecycleMachine`: `pending → running → completed | failed | cancelled | timed_out`. Terminal states are sticky. Every transition is timestamped with monotonic milliseconds. The lifecycle state travels on `NodeStateInterface` through every node in the graph.

```
pending ──start──▶ running ──succeed──▶ completed
                      │
                      ├──fail(error)──▶ failed
                      ├──cancel(reason)▶ cancelled
                      └──timeout──────▶ timed_out
```

## ⦿ No mandatory external runtime

Dagonizer runs in-process by default. No queue, scheduler, external state store, or daemon is required to get a graph moving. DAG definitions are plain JSON-LD documents: store the serialized JSON in files, databases, or configuration services, load it at runtime via `DAGDocument.load(json)`, then register with `dispatcher.registerDAG(dag)`. When you do need remote or worker execution, the same DAG boundary travels through the container/worker contract; there is no separate composition format for those hosts.

## ⦿ See it in action

Three end-to-end workflows, one runtime. Two execute LLM-agent workflows; the third is pure deterministic ETL. The dispatcher, DAG document model, lifecycle, and checkpoint semantics stay the same across all three.

**[The Archivist](/examples/the-archivist)** — LLM-agent orchestration. A bibliographic assistant workflow with intent classification, tool DAG fan-out, memory recall, retry, provenance, and checkpoint-aware response generation.

**[The Dispatcher](/examples/the-dispatcher)** — Human-in-the-loop support routing. A warm-handoff support pipeline where messages route through automated response, operator escalation with park/resume, or off-topic decline.

**[The Cartographer](/examples/the-cartographer)** — Data orchestration and streaming ETL. Multiple source entrypoints run their own ingest DAGs, converge through an open gather, then scatter into typed enrichment pipelines for geo resolution, GDPR redaction, and insight aggregation. No LLM.
## ⦿ Where it fits

Dagonizer fits workflows whose control boundaries need to stay visible: multiple outcomes, retries, checkpoints, human handoff, fan-out/fan-in, or one shared DAG artifact across docs and runtime.

It is not a prompt wrapper or a hidden scheduler. It is a DAG runtime: you author graph structure explicitly, register the pieces that may run, and keep execution policy attached to the same artifact teams inspect in docs, diagrams, and production code.
