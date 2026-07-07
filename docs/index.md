---
layout: doc
aside: false
title: Dagonizer
description: 'TypeScript DAG orchestration framework for LLM agents and data pipelines: typed nodes, JSON-LD DAGs, streaming, checkpoint resume, plugins, and browser demos.'
hero:
  name: Dagonizer
  text: One engine. Two applications.
  tagline: 'One type-safe DAG engine powers both LLM-agent orchestration and data pipelines / ETL — the node domain differs, the engine is identical. Compose, observe, resume. No external runtime required.'
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
    details: 'ScatterNode accepts an AsyncIterable or AsyncGenerator as its source — a stream drains through the same bounded worker pool as a finite array. concurrency IS the backpressure: the engine pulls the next item only when a worker frees. Resume is durable via an inbox queue: un-acked items reprocess on restart; the stream is never re-read from the beginning. Separately, every LlmAdapterInterface implements chatStream(request, sink) so a CallModelNode can push live per-token deltas to an observation sink while the assembled response still lands in state through the normal path.'
  - icon: ✕
    title: Retry Policies
    details: 'RetryPolicy provides constant, linear, exponential, and decorrelated-jitter strategies. Filter by error type. Cooperates with the abort signal so retries stop on cancellation.'
  - icon: ⊨
    title: JSON-LD Canonical Wire Format
    details: 'DAG definitions are validated against DAGSchema (Ajv 2020-12) at the ingest boundary. DAGDocument.load(json) parses and validates a JSON string; DAGDocument.ofValue(value) validates an already-decoded object. Register the result with dispatcher.registerDAG(dag); everything inside is typed.'
  - icon: ◉
    title: Observability Hooks
    details: 'Subclass Dagonizer and override onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError, onPhaseEnter, and onPhaseExit for structured metrics, tracing, and audit trails.'
  - icon: ⏱
    title: Deterministic Testing
    details: 'VirtualClockProvider and VirtualScheduler replace platform timers in tests. Step through retry delays and deadlines with scheduler.advance(ms).'
---

# Dagonizer

## ⦿ What problem it solves

When work has multiple steps that depend on each other — classify, then fetch, then compose, then save — you need a way to express those dependencies, track shared state as work moves through them, stop safely when something goes wrong, and pick up where you left off if the process crashes. `@studnicky/dagonizer` is that infrastructure. You declare each step as a typed node and connect nodes in a DAG (a **D**irected **A**cyclic **G**raph — a graph where each step points forward to the next, with no cycles). The dispatcher runs the graph, routes between steps based on the output each step returns, and handles retries, cancellation, and checkpoint/resume without your nodes knowing about any of it.

A **DAG** is therefore a graph of steps where each step's output drives the routing decision for the next step. Non-technical readers can think of it as a flowchart where each box is a typed function and the arrows are labelled with the outcomes.

## ⦿ One engine, two applications

`@studnicky/dagonizer` is a single type-safe, resumable, abortable DAG/workflow engine. LLM-agent orchestration and data-orchestration / ETL run on the identical core — only the node domain differs. Three runnable in-browser demos prove it: **The Archivist** (LLM agents — a bibliographic assistant), **The Dispatcher** (LLM agents with a human in the loop — warm-handoff support), and **The Cartographer** (streaming multi-format satellite tracking feeds, geo-resolution, GDPR redaction, continent-level insights — no LLM).

## ⦿ What it is

A **node** is a typed, stateless unit of work that receives a batch of state items and a context (including an `AbortSignal`) and returns a routed batch — each item mapped to a named output port. Nodes receive external dependencies through their constructors. The dispatcher routes items to the next node based on their port. Extend `MonadicNode<TState, TOutput>` or implement `NodeInterface<TState, TOutput>` directly; per-item behavior lives inside the node's own `execute(batch, context)` loop. Five placement kinds cover the composition space.

| Kind | What it does |
|------|-------------|
| `single` | One node; output name selects the next vertex |
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

Dagonizer runs in-process. No worker pool, no external state store, no IPC. DAG definitions are plain JSON objects: store them in files, databases, or configuration services and load them at runtime via `DAGDocument.load(json)` (or `DAGDocument.ofValue(value)` for already-decoded objects), then register with `dispatcher.registerDAG(dag)`. The framework is browser-runnable; no Node.js-only primitives in the core engine.

## ⦿ See it in action

Three demos, one engine — each a different role the dispatcher can run, all live in the browser with no server. Two exercise the LLM-agent surface; the third is pure deterministic ETL. Same core, same DAG topology — only the node domain differs.

**[The Archivist](/examples/the-archivist)** — *the cataloguer.* LLM agents. A bibliographic-assistant pipeline: classify intent, scatter scout nodes over source arrays, embedded search and compose sub-DAGs, retry with decorrelated-jitter backoff, checkpoint, provenance. Exercises the full LLM-agent composition surface.

**[The Dispatcher](/examples/the-dispatcher)** — *the router.* LLM agents with a human in the loop. A warm-handoff support pipeline: a classifier routes each message, the AI either composes a reply instantly or the flow parks and waits for a human operator, then resumes from checkpoint on their response. A deterministic "trolley switch" can force human routing on top of the LLM decision. Demonstrates HITL Park-and-Correlate and checkpoint/resume.

**[The Cartographer](/examples/the-cartographer)** — *the mapmaker.* Data orchestration / ETL / streaming. Fans multi-format satellite tracking feeds (CSV, JSON, gzip-NDJSON) through per-format ingest sub-DAGs into one canonical model. Demonstrates branching conditional routing (skip geo when the source pre-resolved location, skip GDPR redaction when no PII is present), offline geo-resolution via `@rapideditor/country-coder`, live IP geo via `freeipapi`, GDPR PII redaction, and continent-level routing-savings insights. No LLM. Runs entirely in the browser.

## ⦿ Why "Dagonizer"

The name compresses the three ideas the project is built on.

**The structure — a DAG.** The engine executes a [**D**irected **A**cyclic **G**raph][dag]: steps joined by forward-only edges, with no cycles, so the steps always admit a well-defined execution order. Engineers compose DAGs constantly — build graphs, task schedulers, spreadsheet recalculation, linker symbol resolution, and now agent tool-call chains — often without naming the structure as such. Dagonizer makes the DAG the explicit, type-safe unit of composition.

**The role — an orchestrator.** In H. P. Lovecraft's fiction, [Dagon][dagon] is the primordial deity that presides over the submerged multitudes of the Deep Ones — first evoked in the 1919 short story of the same name. The image fits an engine whose job is to marshal many small autonomous workers — LLM agents, ETL stages — through one coordinated flow. The workers are the multitude; Dagonizer is what directs them.

**The shape — ports and adapters.** Backends plug into Dagonizer through adapter contracts — `LlmAdapterInterface`, `StoreInterface`, `ClockProviderInterface`, and the rest — never through callbacks or function-passing. That is the [hexagonal "ports and adapters" architecture][hex] described by Alistair Cockburn: capabilities snap together at the boundary like interchangeable parts, and the core stays closed to modification.

Read together, **Dagonizer is "the orchestrator of the DAGs."** Spoken aloud it also resolves to *dag-on-eyes-er* — a deliberate nod to the [Eye of Dagon][eye], and to a logo that is meant to be just slightly unsettling.

[dag]: https://en.wikipedia.org/wiki/Directed_acyclic_graph
[dagon]: https://en.wikipedia.org/wiki/Dagon_%28short_story%29
[hex]: https://alistair.cockburn.us/hexagonal-architecture
[eye]: https://runescape.wiki/w/Eye_of_Dagon
