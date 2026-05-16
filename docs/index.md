---
layout: doc
title: Dagonizer
---

<div class="dagonizer-hero">
  <h1>Dagonizer</h1>
  <p class="tagline">Omniscient orchestration for directed acyclic graphs. Type-safe stages, abortable execution, deterministic resume.</p>
  <p class="subtitle"><em>Every transition observed. Every flow recorded.</em></p>
  <div class="actions">
    <a href="/getting-started" class="VPButton medium brand">Get Started</a>
    <a href="/architecture" class="VPButton medium alt">Architecture</a>
    <a href="https://github.com/Studnicky/Dagonizer" class="VPButton medium ghost">GitHub</a>
  </div>
</div>

<div class="feature-grid">
  <div class="card">
    <h3>Declarative DAG</h3>
    <p>Define flows as plain JSON objects. Stages, routing, and entrypoint form a directed acyclic graph the dispatcher walks at runtime.</p>
  </div>
  <div class="card">
    <h3>Parallel & Fan-Out</h3>
    <p>Run independent stages concurrently with <code>parallel</code> groups. Apply one operation to every item in a collection with <code>fan-out</code> and configurable concurrency.</p>
  </div>
  <div class="card">
    <h3>Cancellation</h3>
    <p>Vigilant abort propagation through the stage graph. Pass a caller-controlled <code>AbortSignal</code> or a <code>deadlineMs</code> hard limit; the dispatcher composes them and propagates cancellation to every in-flight operation.</p>
  </div>
  <div class="card">
    <h3>Retry</h3>
    <p><code>RetryPolicy</code> provides constant, linear, exponential, and decorrelated-jitter strategies. Filter by error type; cooperates cleanly with the dispatcher's abort signal.</p>
  </div>
  <div class="card">
    <h3>Checkpoint</h3>
    <p>Snapshot a paused DAG at its cursor. Serialize to JSON, store anywhere, restore and resume with a new <code>Execution</code> that picks up exactly where it left off.</p>
  </div>
  <div class="card">
    <h3>Type-Safe Routing</h3>
    <p>Operation output types narrow the routing map at compile time. An unwired output is a TypeScript error before <code>registerDAG</code> confirms it at runtime.</p>
  </div>
  <div class="card">
    <h3>JSON Schema Validation</h3>
    <p>DAG configs are validated against <code>DAGSchema</code> (Ajv 2020-12) at the ingest boundary. <code>Dagonizer.load</code> is the single entry point for external JSON.</p>
  </div>
  <div class="card">
    <h3>Observability</h3>
    <p>Subclass <code>Dagonizer</code> and override <code>onFlowStart</code>, <code>onFlowEnd</code>, <code>onNodeStart</code>, <code>onNodeEnd</code>, and <code>onError</code> for structured metrics and tracing.</p>
  </div>
  <div class="card">
    <h3>Deterministic Testing</h3>
    <p><code>VirtualClockProvider</code> and <code>VirtualScheduler</code> replace platform timers in tests. Step through retry delays and deadlines with <code>scheduler.advance(ms)</code>.</p>
  </div>
</div>
