---
title: 'Example 30: Progress Events'
description: 'The Dispatcher host turns lifecycle hooks into trace/progress events and renders them beside the executing DAG.'
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

## Lifecycle Projection

Progress Events are read-side projections built from the Dagonizer lifecycle. In the Dispatcher host, observer hooks become trace rows, active-node highlights, completed edges, and error markers beside the DAG.

It sits one layer above [Example 18: Observability](./18-observability): hooks report flow and node events; the host turns those callbacks into UI state or transport messages.

## Registered Flow

### DAG registration and diagram

The DAG stays unchanged. Progress comes from the observer that watches these placements execute and projects lifecycle into the trace panel and graph state.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher progress DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

The Dispatcher host maps lifecycle hooks into view-model events:

- `onNodeStart` appends a `start` trace event and marks the DAG node active.
- `onNodeEnd` appends an `end` trace event, marks the node completed, and flashes the traversed edge.
- `onError` appends an `error` trace event and marks the node errored.

### Run

```bash
pnpm run site:dev
```

Visit [The Dispatcher](./the-dispatcher) and watch lifecycle events appear in the Trace pane while the DAG advances.

## Projection Boundary

The observer layer receives lifecycle callbacks from the dispatcher and projects them into trace records plus graph state. The DAG remains unchanged; progress is a read-side projection of execution events. Multiple UI panes can consume the same event stream without adding progress nodes to the workflow.

That separation keeps progress cheap to add. A browser trace, CLI spinner, log sink, or server-sent events endpoint can all subscribe to the same lifecycle-derived stream.

## Code Samples

The observer snippet shows lifecycle hooks becoming Dispatcher trace state. The DAG snippet is included to show that the graph itself does not contain progress-only nodes.

<<< @/../examples/the-dispatcher/app/DispatcherRunner.vue#dispatcher-browser-observer

## Usage

Progress events project node-level execution into UI, CLI, SSE, or log updates without adding progress-specific nodes to the graph. The runtime emits lifecycle facts; each host decides how to display or forward them.

That keeps progress logic at the host boundary instead of inside business nodes.

## Runtime Notes

### DAG definition

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

- **Lifecycle hooks to progress events.** The Dispatcher observer converts engine hooks into `TraceEvent` records.
- **Multiple subscribers.** The same hook updates the text trace, DAG graph, and log feed.
- **Browser-visible progress.** The right-side **Trace** tab and **DAG** tab subscribe to these events.
- **Transport option.** For server transports, `@studnicky/dagonizer/progress` still provides `EventBus` and `SseStream`; the Dispatcher host applies the same hook-to-progress boundary in the browser UI.

## Related Concepts

- [Observability guide](../guide/observability) - full hook reference and EventBus multiplexing patterns
- [Example 18: Observability](./18-observability) - subclass hooks: onFlowStart, onFlowEnd, onNodeStart, onNodeEnd, onError
- [Example 20: Streaming execution](./20-streaming) - async-iterable execution API: per-node progress events
