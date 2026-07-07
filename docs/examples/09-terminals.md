---
title: 'Example 09: Terminal Nodes'
description: 'TerminalNode placements. Three patterns for ending a flow with an explicit completed or failed outcome.'
seeAlso:
  - text: 'DAGBuilder, `.terminal()`'
    link: '../guide/builder'
    description: 'full method reference and signature'
  - text: 'Visualization'
    link: '../guide/visualization'
    description: 'render DAGs with TerminalNode endpoints as Mermaid'
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
    description: 'scatter routing with named terminal targets'
---

<script setup lang="ts">
import { gdprComplianceDAG, supportDispatcherDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 09: Terminal Nodes

## What It Is

Terminal nodes are explicit graph endpoints. They tell Dagonizer whether a branch completes or fails, and they make "the flow stops here" visible in JSON-LD, Mermaid, lifecycle events, and embedded-DAG parent routing.

The runnable examples show the two shapes application code usually needs: a shared successful endpoint in The Dispatcher, and completed/failed child endpoints in The Cartographer's GDPR compliance sub-DAG.

## How It Works

A terminal placement does not execute user code. It declares the endpoint reached by a named route and sets the lifecycle outcome for that branch. When a parent embeds a child DAG, the child's terminal outcome becomes the parent embedded placement's `success` or `error` output.

That means application code should route to terminals deliberately. A missing route is a graph bug; a terminal route is a documented outcome.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

`TerminalNode` placements name the endpoints of a flow and carry an `outcome` declaration (`completed` or `failed`). Every flow branch must end at a named `TerminalNode`. The runnable examples show the two common patterns: shared completed terminals in a parent flow, and completed/failed terminals inside a reusable sub-DAG whose parent routes on `success` or `error`.

<DagJsonMermaid :dag="supportDispatcherDAG" title="support-dispatcher" aria-label="The Dispatcher support JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="gdprComplianceDAG" title="gdpr-compliance" aria-label="The Cartographer GDPR compliance JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Terminal nodes let applications name every graph endpoint and attach an explicit lifecycle outcome to it. They belong on completed, failed, rejected, or declined paths that must be visible in the DAG instead of implied by "no next node."

For application builders, terminals make support escalation, policy rejection, compliance failure, and normal completion all observable without special-case code at the runner boundary.

## Code Samples

Read the snippets with the diagrams nearby so the TypeScript behavior, JSON-LD graph shape, and runtime output line up as one contract.

#### Dispatcher: shared completed terminal

<<< @/../examples/the-dispatcher/dag.ts#dispatcher-bundle

The Dispatcher has one `end` terminal. Routine AI replies, operator-handled escalations, and off-topic declines all converge there. The terminal declares the lifecycle outcome; the nodes only route.

#### Cartographer: completed and failed child terminals

<<< @/../examples/the-cartographer/embedded-dags/GdprComplianceDAG.ts#gdpr-compliance-dag

The GDPR sub-DAG owns its internal terminal semantics: `compliant` means the child lifecycle completes, while `violation` marks the child as failed. Any parent that embeds this DAG receives `success` or `error` from that lifecycle outcome.

#### Parent routing from embedded outcome

<<< @/../examples/the-cartographer/dag.ts#event-pipeline-typed-dag

Each per-event pipeline routes an embedded child DAG's `success` to `done` and `error` to `rejected`; `rejected` is a failed terminal. The parent does not inspect child internals.

## Details for Nerds

- **Shared completed terminal.** The Dispatcher routes routine, escalated, and off-topic support paths to one `end` terminal with `outcome: 'completed'`.
- **Explicit failed terminal.** The Cartographer `gdpr-compliance` sub-DAG routes `redact-pii` to either `compliant` (`completed`) or `violation` (`failed`).
- **Embedded-DAG routing to named terminals.** Cartographer parent DAGs place `gdpr-compliance` with `.embed(...)`; the child terminal outcome becomes the parent placement's `success` or `error` route.

## Related Concepts

- [DAGBuilder, `.terminal()`](../guide/builder) - full method reference and signature
- [Visualization](../guide/visualization) - render DAGs with TerminalNode endpoints as Mermaid
- [Example 05: Embedded DAGs](./05-embedded-dags) - scatter routing with named terminal targets
