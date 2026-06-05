---
layout: doc
aside: false
title: Dagonizer
hero:
  name: Dagonizer
  text: One engine. Two applications.
  tagline: 'One type-safe DAG engine powers both agentic LLM orchestration and data pipelines / ETL — the node domain differs, the engine is identical. Compose, observe, resume. No external runtime required.'
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
    title: Scatter Composition
    details: 'Isolate a state clone and run a body (registered node or sub-DAG) in it. Gather produced clone state back into the parent via map, append, partition, or custom strategies. Route on the aggregate outcome.'
  - icon: ⫴
    title: Streaming & Backpressure
    details: 'ScatterNode accepts an AsyncIterable or AsyncGenerator as its source — a stream drains through the same bounded worker pool as a finite array. concurrency IS the backpressure: the engine pulls the next item only when a worker frees. Resume is durable via an inbox queue: un-acked items reprocess on restart; the stream is never re-read from the beginning.'
  - icon: ✕
    title: Retry Policies
    details: 'RetryPolicy provides constant, linear, exponential, and decorrelated-jitter strategies. Filter by error type. Cooperates with the abort signal so retries stop on cancellation.'
  - icon: ⊨
    title: JSON-LD Canonical Wire Format
    details: 'DAG definitions are validated against DAGSchema (Ajv 2020-12) at the ingest boundary. Dagonizer.load is the single entry point for external JSON; everything inside is typed.'
  - icon: ◉
    title: Observability Hooks
    details: 'Subclass Dagonizer and override onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, and onError for structured metrics, tracing, and audit trails.'
  - icon: ⏱
    title: Deterministic Testing
    details: 'VirtualClockProvider and VirtualScheduler replace platform timers in tests. Step through retry delays and deadlines with scheduler.advance(ms).'
  - icon: ⊜
    title: Contract-derived Flows
    details: 'Declare what each operation produces and hardRequires. DAGDeriver builds the topology by matching the data graph. Multi-port routing and scatter sub-DAG composition come from annotations; adding an operation is one contract and the flow rewires itself.'
---

## ⦿ One engine, two applications

`@noocodex/dagonizer` is a single type-safe, resumable, abortable DAG/workflow engine. Agentic LLM orchestration and data-orchestration / ETL run on the identical core — only the node domain differs. Two runnable in-browser demos prove it: The Archivist (LLM agents, bibliographic assistant) and The Cartographer (streaming multi-format satellite tracking feeds, geo-resolution, GDPR redaction, continent-level insights — no LLM).

## ⦿ What it is

A **node** is a typed, stateless unit of work that receives shared state and a context (including an `AbortSignal`) and returns a named output. The dispatcher routes on that output to the next node. Six placement kinds cover the composition space.

| Kind | What it does |
|------|-------------|
| `single` | One node; output name selects the next vertex |
| `parallel` | Multiple independent nodes run concurrently; combine strategy reduces to one route |
| `scatter` | Isolate one state clone per item in a source array, run a body (node or sub-DAG) in each clone, gather produced clone state back, route on aggregate outcome |
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

## ⦿ No external runtime

Dagonizer runs in-process. No worker pool, no external state store, no IPC. DAG definitions are plain JSON objects: store them in files, databases, or configuration services and load them at runtime via `Dagonizer.load`. The framework is browser-runnable; no Node.js-only primitives in the core engine.

## ⦿ See it in action

Both demos run live in the browser with no server required. Start with either depending on your domain.

**[The Archivist](/examples/the-archivist)** — LLM agents. A bibliographic-assistant pipeline: classify intent, scatter scout nodes over source arrays, embedded search and compose sub-DAGs, retry with decorrelated-jitter backoff, checkpoint, provenance. Exercises the full agentic composition surface.

**[The Cartographer](/examples/the-cartographer)** — data orchestration / ETL / streaming. Fans multi-format satellite tracking feeds (CSV, JSON, gzip-NDJSON) through per-format ingest sub-DAGs into one canonical model. Demonstrates branching conditional routing (skip geo when the source pre-resolved location, skip GDPR redaction when no PII is present), offline geo-resolution via `@rapideditor/country-coder`, live IP geo via `freeipapi`, GDPR PII redaction, and continent-level routing-savings insights. No LLM. Runs entirely in the browser.
