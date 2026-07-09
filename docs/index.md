---
layout: doc
aside: false
title: Dagonizer
description: 'TypeScript DAG orchestration framework for LLM agents and data pipelines: typed nodes, JSON-LD DAGs, streaming, checkpoint resume, plugins, and browser demos.'
hero:
  name: Dagonizer
  text: One engine. Many DAGs.
  tagline: 'One type-safe DAG engine powers LLM-agent orchestration, streaming data pipelines, and plugin-composed applications. Author the graph, register the parts, observe the run, resume from the cursor. The ritual is practical.'
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

A **DAG** is therefore a graph of placements where each placement's output drives the routing decision for the next placement. Non-technical readers can think of it as a flowchart where each box is a typed function or registered sub-DAG, the arrows are labeled outcomes, and every box has a canonical IRI under the hood. The eye of the graph is the IRI; the display name is just the label etched on the box.

## ⦿ One engine, two applications

`@studnicky/dagonizer` is a single type-safe, resumable, abortable DAG/workflow engine. LLM-agent orchestration and data-orchestration / ETL run on the identical core — only the node domain differs. Three runnable in-browser demos prove it: **The Archivist** (LLM agents — a bibliographic assistant), **The Dispatcher** (LLM agents with a human in the loop — warm-handoff support), and **The Cartographer** (streaming multi-format satellite tracking feeds, geo-resolution, GDPR redaction, continent-level insights — no LLM).

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

Dagonizer runs in-process by default. No queue, scheduler, external state store, or daemon is required to get a graph moving. DAG definitions are plain JSON-LD documents: store the serialized JSON in files, databases, or configuration services, load it at runtime via `DAGDocument.load(json)`, then register with `dispatcher.registerDAG(dag)`. When you do need remote or worker execution, the same DAG boundary travels through the container/worker contract; no second composition model crawls out of the deep.

## ⦿ See it in action

Three demos, one engine — each a different role the dispatcher can run, all live in the browser with no server. Two exercise the LLM-agent surface; the third is pure deterministic ETL. Same core, same DAG topology — only the node domain differs.

**[The Archivist](/examples/the-archivist)** — *the cataloguer.* LLM agents. A bibliographic-assistant pipeline: classify intent, scatter scout nodes over source arrays, embedded search and compose sub-DAGs, retry with decorrelated-jitter backoff, checkpoint, provenance. Exercises the full LLM-agent composition surface.

**[The Dispatcher](/examples/the-dispatcher)** — *the router.* LLM agents with a human in the loop. A warm-handoff support pipeline: a classifier routes each message, the AI either composes a reply instantly or the flow parks and waits for a human operator, then resumes from checkpoint on their response. A deterministic "trolley switch" can force human routing on top of the LLM decision. Demonstrates HITL Park-and-Correlate and checkpoint/resume.

**[The Cartographer](/examples/the-cartographer)** — *the mapmaker.* Data orchestration / ETL / streaming. Multiple source entrypoints each run their own feed/unpack/normalize DAG, converge through a canonical open gather, then scatter through typed event pipelines into geo-resolution, GDPR redaction, and continent-level insights. It demonstrates open intake, explicit gather barriers, worker/container roles, and plugin-shaped DAG parts. No LLM. Runs entirely in the browser.

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
