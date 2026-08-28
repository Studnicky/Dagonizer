---
title: 'Example 32: Dispatcher CLI'
description: 'The Dispatcher command-line flow exercises the same support DAG as the interactive Dispatcher host and service integrations: routine AI handling, escalation parking, checkpoint capture, operator resume, and the human-mode trolley switch.'
seeAlso:
  - text: 'The Dispatcher'
    link: './the-dispatcher'
    description: 'support workflow built on the same support DAG'
  - text: 'Example 31: HITL Park-and-Correlate'
    link: './31-hitl'
    description: 'parked result, checkpoint capture, and resume mechanics'
  - text: 'Example 28: Runner and Triggers'
    link: './28-runner'
    description: 'customer-send and operator-resume trigger model'
  - text: 'Guide: HITL Park-and-Correlate'
    link: '../guide/hitl'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 32: Dispatcher CLI

## CLI Interface

Dispatcher CLI runs the `support-dispatcher` DAG through a terminal projection instead of the interactive Dispatcher host. The script covers the same routine, parked, checkpoint, resume, and forced-human scenarios as the interactive workflow.

The DAG document does not change. Only the trigger source and projection target change: scripted inputs in, terminal output out.

## Registered Flow

### DAG registration and diagram

The script registers `support-dispatcher`, runs a routine message, parks an escalated message, captures a checkpoint, injects an operator response, resumes from the parked cursor, and then repeats the flow with the human-mode trolley switch enabled.

The graph stays identical across CLI, interactive, and server interfaces; only the surrounding trigger and service wiring change.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher CLI DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/32-dispatcher.ts
```

## Trigger and Projection Boundary

The CLI constructs the same dispatcher, registers the same node bundle, seeds state from scripted inputs, and calls `execute` or `resume` exactly as the interactive host does. The only difference is trigger source and projection target: terminal output replaces the interactive panes.

That makes it a useful template for server handlers. Replace scripted CLI inputs with an HTTP request, queue message, or scheduled job and the DAG contract remains unchanged.

## Code Samples

The CLI runner is the complete scenario file. It wires the LLM adapter cascade, registers the Dispatcher nodes, runs three scenarios, and exercises checkpoint/resume without the operator UI.

<<< @/../examples/32-dispatcher.ts

## Usage

The Dispatcher CLI adapts the same HITL support workflow to scripts, tests, and server handlers without carrying the interactive operator interface with it.

It is also the shortest end-to-end debug path for the workflow: no DOM, no panels, just registration, execution, checkpoint, resume, and printed outcomes.

## Runtime Notes

- **Same DAG, different trigger.** UI actions and CLI scenarios both call `dispatcher.execute` and `dispatcher.resume` around the same registered DAG.
- **Routine path.** A normal support question routes through `ai-compose` and `send-response` without parking.
- **Escalation path.** Refund and billing messages park at `park-for-operator`, capture a checkpoint, and resume after an operator response is written into state.
- **Trolley switch.** `humanMode = true` forces even routine messages to the operator path, making the human gate explicit and testable.
- **Provider wiring.** The CLI resolves an LLM adapter through the same adapter cascade pattern used by the interactive host.

## Related Concepts

- [The Dispatcher](./the-dispatcher) - support workflow built on the same support DAG
- [Example 31: HITL Park-and-Correlate](./31-hitl) - parked result, checkpoint capture, and resume mechanics
- [Example 28: Runner and Triggers](./28-runner) - UI trigger model for customer send and operator resume
- [Guide: HITL Park-and-Correlate](../guide/hitl)
