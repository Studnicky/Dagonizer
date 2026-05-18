---
layout: doc
title: Dagonizer
---

<div class="dagonizer-hero">
  <h1>Dagonizer</h1>
  <p class="tagline">A TypeScript framework for orchestrating work as a directed acyclic graph of typed nodes, with a state machine lifecycle.</p>
  <p class="subtitle"><em>Compose. Observe. Resume. No external runtime required.</em></p>
  <div class="actions">
    <a href="/getting-started" class="VPButton medium brand">Get Started</a>
    <a href="/architecture" class="VPButton medium alt">Architecture</a>
    <a href="https://github.com/Studnicky/Dagonizer" class="VPButton medium ghost">GitHub</a>
  </div>
</div>

Dagonizer is a self-contained DAG orchestration framework. Define flows as plain JSON objects or via the fluent `DAGBuilder` API, register typed nodes, and execute. The dispatcher walks the node graph, propagates cancellation signals, retries on failure, and snapshots in-flight state for deterministic resume — with no external broker, queue, or process boundary required.

## What it is

A **node** is a typed, stateless unit of work that receives shared state and a context (including an `AbortSignal`) and returns a named output. The dispatcher routes on that output to the next node. Four placement kinds cover the full composition space:

| Kind | What it does |
|------|-------------|
| `single` | One node; output name selects the next vertex |
| `parallel` | Multiple independent nodes run concurrently; combine strategy reduces to one route |
| `fan-out` | One node per item in a state array; fan-in strategy merges results |
| `deep-dag` | A registered DAG invoked as a nested call; state mapped in and out |

## FSM-driven lifecycle

Every execution runs through `DAGLifecycleMachine`: `pending → running → completed | failed | cancelled | timed_out`. Terminal states are sticky. Every transition is timestamped with monotonic milliseconds. The lifecycle state travels on `NodeStateInterface` through every node in the graph.

```
pending ──start──▶ running ──succeed──▶ completed
                      │
                      ├──fail(error)──▶ failed
                      ├──cancel(reason)▶ cancelled
                      └──timeout──────▶ timed_out
```

## Key capabilities

<div class="feature-grid">
  <div class="card">
    <h3>Type-Safe Nodes</h3>
    <p>Output types narrow the routing map at compile time. An unwired output is a TypeScript error before <code>registerDAG</code> confirms it at runtime.</p>
  </div>
  <div class="card">
    <h3>Abortable Execution</h3>
    <p>Pass a caller-controlled <code>AbortSignal</code> or a <code>deadlineMs</code> hard limit. The dispatcher composes them and propagates cancellation through every in-flight operation and deep-DAG nesting level.</p>
  </div>
  <div class="card">
    <h3>Deterministic Resume</h3>
    <p>Snapshot a paused DAG at its cursor. Serialize to JSON, store anywhere, restore and resume with a new <code>Execution</code> that picks up exactly where it left off.</p>
  </div>
  <div class="card">
    <h3>Deep-DAG Composition</h3>
    <p>Invoke a registered DAG as a nested node. State maps in before the child runs and out after it returns. Errors and warnings bubble up automatically.</p>
  </div>
  <div class="card">
    <h3>Parallel & Fan-Out</h3>
    <p>Run independent nodes concurrently with <code>parallel</code> groups. Apply one node to every item in a collection with <code>fan-out</code> and configurable concurrency.</p>
  </div>
  <div class="card">
    <h3>Retry Policies</h3>
    <p><code>RetryPolicy</code> provides constant, linear, exponential, and decorrelated-jitter strategies. Filter by error type; cooperates with the abort signal so retries stop immediately on cancellation.</p>
  </div>
  <div class="card">
    <h3>JSON-LD Canonical Wire Format</h3>
    <p>DAG definitions are validated against <code>DAGSchema</code> (Ajv 2020-12) at the ingest boundary. <code>Dagonizer.load</code> is the single entry point for external JSON — everything inside is fully typed.</p>
  </div>
  <div class="card">
    <h3>Observability Hooks</h3>
    <p>Subclass <code>Dagonizer</code> and override <code>onFlowStart</code>, <code>onFlowEnd</code>, <code>onNodeStart</code>, <code>onNodeEnd</code>, and <code>onError</code> for structured metrics, tracing, and audit trails.</p>
  </div>
  <div class="card">
    <h3>Deterministic Testing</h3>
    <p><code>VirtualClockProvider</code> and <code>VirtualScheduler</code> replace platform timers in tests. Step through retry delays and deadlines with <code>scheduler.advance(ms)</code>.</p>
  </div>
</div>

## No external runtime

Dagonizer runs in-process. No worker pool, no external state store, no IPC. DAG definitions are plain JSON objects — store them in files, databases, or configuration services and load them at runtime via `Dagonizer.load`. The framework is browser-runnable: no Node.js-only primitives in the core engine.

## See it in action

[The Archivist](/examples/the-archivist) is an end-to-end in-browser demo built entirely on Dagonizer — a bibliographic-assistant pipeline that exercises linear intake, fan-out, deep-DAG composition, cancellation, retry, checkpoint, and visualization in a single runnable flow.
