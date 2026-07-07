---
title: 'Example 32: Dispatcher CLI'
description: 'The Dispatcher command-line runner exercises the same support DAG as the browser demo: routine AI handling, escalation parking, checkpoint capture, operator resume, and the human-mode trolley switch.'
seeAlso:
  - text: 'The Dispatcher'
    link: './the-dispatcher'
    description: 'browser-runnable version of the same support flow'
  - text: 'Example 31: HITL Park-and-Correlate'
    link: './31-hitl'
    description: 'parked result, checkpoint capture, and resume mechanics'
  - text: 'Example 28: Runner and Triggers'
    link: './28-runner'
    description: 'UI trigger model for customer send and operator resume'
  - text: 'Guide: HITL Park-and-Correlate'
    link: '../guide/hitl'
---

<script setup lang="ts">
import { supportDispatcherDAG } from '../../examples/the-dispatcher/dag.ts';
</script>

# Example 32: Dispatcher CLI

## What It Is

Dispatcher CLI proves the support DAG is not a browser-only demo. The command-line runner exercises the same flow as The Dispatcher page: routine handling, escalation parking, checkpoint capture, operator resume, and the human-mode trolley switch.

The graph stays the same. The trigger and projection layer changes from Vue state to terminal output.

## How It Works

The CLI constructs the same dispatcher, registers the same node bundle, seeds state from scripted inputs, and calls `execute` or `resume` exactly as the browser runner does. The only difference is trigger source and projection target: terminal output replaces Vue state.

That makes it a useful template for server handlers. Replace scripted CLI inputs with an HTTP request, queue message, or scheduled job and the DAG contract remains unchanged.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The command-line Dispatcher runner proves the browser hand-off flow is not tied to the Vue demo. It registers the same `support-dispatcher` DAG, executes a routine customer message, parks an escalated message, captures a checkpoint, injects an operator response, resumes from the parked cursor, and then repeats the flow with the human-mode trolley switch enabled.

The CLI and browser runner use the same canonical JSON-LD DAG. The graph shape is unchanged across UI, CLI, and server handlers; only the trigger and service wiring differ.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher CLI DAG" aria-label="Support dispatcher JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/32-dispatcher.ts
```

Use this page when you want the Dispatcher behavior without the browser UI, or when you need a compact script for adapting the support flow to a server handler.

## What It Lets You Do

The Dispatcher CLI lets applications run the same HITL support flow without the browser UI. Use it as the compact proof that the support DAG is portable across browser triggers, command-line scripts, and server handlers.

It is also the shortest path for debugging the support workflow: no DOM, no panels, just registration, execution, checkpoint, resume, and printed outcomes.

## Code Samples

The CLI runner is the complete runnable scenario file. It wires the LLM adapter cascade, registers the Dispatcher nodes, runs three scenarios, and demonstrates checkpoint/resume without a browser.

<<< @/../examples/32-dispatcher.ts

## Details for Nerds

- **Same DAG, different trigger.** Browser buttons and CLI scenarios both call `dispatcher.execute` and `dispatcher.resume` around the same registered DAG.
- **Routine path.** A normal support question routes through `ai-compose` and `send-response` without parking.
- **Escalation path.** Refund and billing messages park at `park-for-operator`, capture a checkpoint, and resume after an operator response is written into state.
- **Trolley switch.** `humanMode = true` forces even routine messages to the operator path, making the human gate explicit and testable.
- **Provider wiring.** The CLI resolves an LLM adapter through the same adapter cascade pattern used by the runnable demos.

## Related Concepts

- [The Dispatcher](./the-dispatcher) - browser-runnable version of the same support flow
- [Example 31: HITL Park-and-Correlate](./31-hitl) - parked result, checkpoint capture, and resume mechanics
- [Example 28: Runner and Triggers](./28-runner) - UI trigger model for customer send and operator resume
- [Guide: HITL Park-and-Correlate](../guide/hitl)
