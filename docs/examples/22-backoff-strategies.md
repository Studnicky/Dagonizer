---
title: 'Example 22: Retry Timing and Salvage'
description: 'The Archivist models retries as DAG flow and delegates timing/deadline policy to runtime services, so retry, salvage, and final response paths stay visible in JSON-LD.'
seeAlso:
  - text: 'Example 07: Retry Flow'
    link: './07-retry'
    description: 'retry as a flow shape in the Archivist'
  - text: 'Example: Virtual clock'
    link: './virtual-clock'
    description: 'VirtualClockProvider + VirtualScheduler for deterministic time'
  - text: 'Reference: Runtime'
    link: '../reference/runtime'
    description: 'RetryPolicy, BackoffStrategy, Scheduler'
---

<script setup lang="ts">
import { ComposeRetryLoopDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 22: Retry Timing and Salvage

## What It Is

Retry Timing and Salvage separates two concerns that applications often tangle together: the DAG shows where retry and recovery can happen, while runtime services decide how long retryable work waits.

The Archivist uses this shape for model-backed response composition. Retry edges, validation loops, and salvage paths are visible in JSON-LD; deadlines, backoff, jitter, and scheduler behavior stay in runtime policy.

## How It Works

The DAG contains the retry and salvage edges. Runtime services decide how long a node-local operation waits before the node returns one of those outputs. State-held retry counters bound attempts, and deterministic salvage nodes convert exhausted retries into explicit graph paths rather than uncaught exceptions or fabricated success.

This keeps operational tuning from rewriting the flow. You can change a backoff strategy without changing which node retries, where salvage runs, or how the parent DAG routes after recovery.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

Backoff strategy changes retry timing, not DAG topology. The [Archivist](./the-archivist) exposes the retry decision as graph shape: `compose-response` can retry, route to salvage, or advance to validation; validation can approve, retry, or exhaust into the same completed terminal.

<DagJsonMermaid :dag="ComposeRetryLoopDAG" title="Archivist compose retry loop" aria-label="Archivist compose retry loop JSON-LD DAG beside Mermaid generated from it." />

The runnable example keeps timing policy out of the DAG literal:

- Node-local deadlines come from the browser/CLI services context.
- Retry budget lives on `ArchivistState`, so loops are bounded by state rather than hidden inside a node.
- Salvage is an explicit route, so deterministic recovery appears beside retries in the generated Mermaid.
- The final terminal is completed even when validation exhausts, because the parent can still respond with the best available grounded draft.

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## What It Lets You Do

Retry timing lets applications tune how long retryable work waits without hiding retry topology inside a node. Use it when developers need retry and salvage routes to stay visible, while runtime configuration controls delay, jitter, deadlines, and scheduler behavior.

The practical result is safer tuning. Product latency targets can change without converting explicit recovery paths into hidden adapter loops.

## Code Samples

The reusable retry loop is the embedded DAG every Archivist answer branch can enter:

<<< @/../examples/the-archivist/embedded-dags/ComposeRetryLoopDAG.ts

The concrete compose node owns node-local timing and routes retry/salvage decisions through the graph:

<<< @/../examples/the-archivist/nodes/composeResponse.ts

The query extraction node uses the same pattern earlier in the run:

<<< @/../examples/the-archivist/nodes/extractQuery.ts#retry-salvage-node

## Details for Nerds

- **Retry as topology.** Retry edges are visible in JSON-LD and Mermaid, so application developers can see where loops occur and which route exits them.
- **Timing as policy.** Deadlines and backoff parameters stay in services/runtime configuration instead of changing DAG shape.
- **Bounded attempts.** State-held counters decide whether a node retries or routes to salvage.
- **Deterministic salvage.** Salvage/exhaustion paths still produce deterministic visitor output when the LLM path is weak.

## Related Concepts

- [Example 07: Retry Flow](./07-retry) - retry as a flow shape in the Archivist
- [Example: Virtual clock](./virtual-clock) - VirtualClockProvider + VirtualScheduler for deterministic time
- [Reference: Runtime](../reference/runtime) - RetryPolicy, BackoffStrategy, Scheduler
