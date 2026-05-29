---
layout: doc
aside: false
title: Dagonizer
hero:
  name: Dagonizer
  text: Orchestrate work as a DAG of typed nodes.
  tagline: 'A TypeScript framework for directed acyclic flows with a state machine lifecycle. Compose, observe, resume. No external runtime required.'
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
    title: Parallel and Scatter
    details: 'Run independent nodes concurrently with parallel groups. Scatter over a source array with configurable concurrency, or run a sub-DAG body in a single clone.'
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

## ⦿ What it is

A **node** is a typed, stateless unit of work that receives shared state and a context (including an `AbortSignal`) and returns a named output. The dispatcher routes on that output to the next node. Four placement kinds cover the composition space.

| Kind | What it does |
|------|-------------|
| `single` | One node; output name selects the next vertex |
| `parallel` | Multiple independent nodes run concurrently; combine strategy reduces to one route |
| `scatter` | Isolate a state clone, run a body (node or sub-DAG) per source item or once for singletons, gather produced clone state back, route on aggregate outcome |

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

[The Archivist](/examples/the-archivist) is an end-to-end in-browser demo built on Dagonizer. It runs a bibliographic-assistant pipeline that exercises linear intake, scatter over source arrays, scatter over sub-DAG bodies, cancellation, retry, checkpoint, and visualization in a single flow. Start there before reading the concepts page.
