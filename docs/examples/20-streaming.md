---
title: 'Example 20: Streaming Execution'
description: 'Dagonizer.execute() returns an Execution<TState> that is both awaitable and AsyncIterable. Iterating yields a NodeResultType<NodeStateInterface> for each node as it completes, before the flow resolves.'
seeAlso:
  - text: 'Example 18: Observability'
    link: './18-observability'
    description: 'lifecycle hooks: onNodeStart, onNodeEnd, onFlowEnd'
  - text: 'Example 06: Cancellation'
    link: './06-cancellation'
    description: 'AbortSignal + deadlineMs to interrupt a running flow'
  - text: 'Reference: Execution'
    link: '../reference/execution'
    description: 'ExecutionResult, NodeResult, Execution type reference'
---

<script setup lang="ts">
import { cartographerWorkersDAG } from '../../examples/the-cartographer/dag.ts';
</script>

# Example 20: Streaming Execution

## Execution Stream Surface

Streaming Execution lets a host observe node completions while the final DAG result is still pending. `Dagonizer.execute()` returns an `Execution<TState>` that can be awaited like a promise or consumed with `for await`.

The Cartographer runner uses this to update the live graph pane as each placement completes, then awaits the same execution for the final state. One call, one run, two consumption styles.

## Caller Observation Flow

### DAG registration and diagram

The host chooses streaming execution to observe each node result as it completes. [The Cartographer](./the-cartographer) uses this in the live DAG pane: `dispatcher.execute()` returns an awaitable async iterable, and the runner iterates stages to light up graph nodes while the final result is still pending.

<DagJsonMermaid :dag="cartographerWorkersDAG" title="Cartographer streaming execution DAG" aria-label="Cartographer worker JSON-LD DAG beside Mermaid generated from it." />

`Dagonizer.execute()` returns an `Execution<TState>` that is both:

### Run

```bash
pnpm run site:dev
```

Visit [The Cartographer](./the-cartographer) and compare the live stream and DAG panes with the `Execution<TState>` stages above.

## Execution Wrapper Model

`execute()` returns an `Execution<TState>` wrapper around one internal run. `for await` consumes node-completion stages from that run, while `await` resolves the cached final result from the same run. The caller can stream first, await later, or only await when no progress UI is needed.

Streaming changes how the host consumes one run, not how the DAG is authored. The JSON-LD graph, registry, routes, cancellation behavior, and final lifecycle stay the same whether the host streams progress or simply awaits completion.

## Code Samples

The runner snippet shows the `for await` loop that feeds the Cartographer graph UI. The DAG snippet is included to make the point explicit: streaming execution changes how the caller observes a run, not how the graph is authored.

<<< @/../examples/the-cartographer/app/CartographerRunner.vue#cartographer-streaming-execution

<<< @/../examples/the-cartographer/dag.ts#cartographer-workers-dag

## Operational Uses

Streaming execution lets hosts observe DAG progress while the final result is still pending. Use it for live graph panes, progress bars, logs, server-sent events, and long-running browser or CLI flows where waiting for the final `ExecutionResult` hides useful intermediate state.

It pairs naturally with cancellation: a UI can show progress, keep a cancel button active, and still receive one final lifecycle result when the run completes or stops.

## Runtime Notes

- **`Execution<TState>` dual interface.** `execute()` returns an object that satisfies both `Promise<ExecutionResultType<TState>>` and `AsyncIterable<NodeResultType<NodeStateInterface>>`. No separate streaming method needed.
- **Awaitable** — `await dispatcher.execute(...)` waits for the final summary (`ExecutionResultType<TState>`).
- **AsyncIterable** — `for await (const stage of dispatcher.execute(...))` yields a `NodeResultType<NodeStateInterface>` for each node as it completes. The base type is used because embedded-child nodes may carry different concrete state shapes.

The two consumption modes share a single internal generator. Iterating and then awaiting returns the cached final result; the flow body runs exactly once.

- **Per-node `NodeResultType<NodeStateInterface>`.** Each yielded value carries `nodeName`, `output`, `state` (typed as the base `NodeStateInterface` so embedded-child nodes with different concrete states are covered), and the node's own lifecycle snapshot. Downcast `stage.state` locally when you need concrete state access.
- **Single pass.** The internal generator runs once. Awaiting after iteration returns the same resolved value; the flow does not re-execute.
- **Compose with cancellation.** Pass `signal` in the execute options to cancel the stream mid-flight; any in-flight node resolves or throws, and the async iterator drains cleanly.

## Related Concepts

- [Example 18: Observability](./18-observability) - lifecycle hooks: onNodeStart, onNodeEnd, onFlowEnd
- [Example 06: Cancellation](./06-cancellation) - AbortSignal + deadlineMs to interrupt a running flow
- [Reference: Execution](../reference/execution) - ExecutionResult, NodeResult, Execution type reference
