---
title: 'Example 30: Progress Events'
description: 'The Dispatcher browser demo turns lifecycle hooks into trace/progress events and renders them alongside the live DAG.'
seeAlso:
  - text: 'Observability guide'
    link: '../guide/observability'
    description: 'full hook reference and EventBus multiplexing patterns'
  - text: 'Example 18: Observability'
    link: './18-observability'
    description: 'subclass hooks: onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError'
  - text: 'Example 20: Streaming execution'
    link: './20-streaming'
    description: 'async-iterable execution API: per-node progress events'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 30: Progress Events

## What It Is

Progress Events are application-facing projections of the Dagonizer lifecycle. The Dispatcher browser demo turns runtime hooks into trace rows, active-node highlights, completed edges, and error markers beside the live DAG.

This page is the UI layer on top of [Example 18: Observability](./18-observability): hooks report what happened; progress events decide how the application displays or transports it.

## How It Works

The observer layer receives lifecycle callbacks from the dispatcher and projects them into trace records plus graph state. The DAG remains unchanged; progress is a read-side projection of execution events. Multiple UI panes can consume the same event stream without adding progress nodes to the workflow.

That separation keeps progress cheap to add. A browser trace, CLI spinner, log sink, or server-sent events endpoint can all subscribe to the same lifecycle-derived stream.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The graph is a normal pipeline; progress events are emitted by the runtime observer while these placements execute. [The Dispatcher](./the-dispatcher) owns the smallest in-browser version through its trace panel.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher progress DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

The browser demo translates lifecycle hooks into view-model events:

- `onNodeStart` appends a `start` trace event and marks the DAG node active.
- `onNodeEnd` appends an `end` trace event, marks the node completed, and flashes the traversed edge.
- `onError` appends an `error` trace event and marks the node errored.

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Progress events let applications turn DAG lifecycle hooks into product UI or transport updates. Use this when a live page, CLI, SSE endpoint, or log sink needs to show node-level progress while the DAG is still running.

They also keep progress out of business logic. Nodes do not emit UI events; the runtime reports lifecycle, and the runner decides how to render it.

## Code Samples

The observer snippet shows lifecycle hooks becoming Dispatcher trace state. The DAG snippet is included to show that the graph itself does not contain progress-only nodes.

<<< @/../docs/.vitepress/theme/components/DispatcherRunner.vue#dispatcher-browser-observer

## Details for Nerds

### DAG definition

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

- **Lifecycle hooks to progress events.** The Dispatcher observer converts engine hooks into `TraceEvent` records.
- **Multiple subscribers.** The same hook updates the text trace, DAG graph, and log feed.
- **Browser-visible progress.** The right-side **Trace** tab and **DAG** tab subscribe to these events.
- **Transport option.** For server transports, `@studnicky/dagonizer/progress` still provides `EventBus` and `SseStream`; the browser runnable demonstrates the hook-to-progress boundary.

## Related Concepts

- [Observability guide](../guide/observability) - full hook reference and EventBus multiplexing patterns
- [Example 18: Observability](./18-observability) - subclass hooks: onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError
- [Example 20: Streaming execution](./20-streaming) - async-iterable execution API: per-node progress events
