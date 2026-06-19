---
title: 'Example: DAGDeriver (contract-derived flow)'
description: 'DAGDeriver derives a DAG topology from OperationContractType declarations. Each operation declares what it needs (hardRequired) and what it produces; the deriver wires produces ↔ hardRequired to build the topology automatically.'
seeAlso:
  - text: 'Contract-derived flows guide'
    link: '../guide/derive'
    description: 'full DAGDeriver API and annotation reference'
  - text: 'Reference: Derive'
    link: '../reference/derive'
  - text: 'Example 02: DAGBuilder'
    link: './02-builder'
    description: 'deterministic ETL authoring path; same canonical output'
  - text: 'Phase 05: EmbeddedDAGNode composition'
    link: './05-embedded-dags'
    description: 'embedded sub-DAG placements'
---

# Example: DAGDeriver (contract-derived flow)

`DAGDeriver` derives a DAG topology from a set of `OperationContractType` declarations. Each operation declares what it needs (`hardRequired`) and what it produces; the deriver matches `produces ↔ hardRequired` to wire the graph automatically. Adding a new operation rewires the flow without touching the existing contracts.

This example demonstrates agentic tool dispatch: a parent flow delegates the actual work to a registered sub-DAG via the `embeddedDAGs` annotation, which the deriver renders as an `EmbeddedDAGNode` whose `dag` runs the child DAG. Swap the child DAG at registration time without rewriting the parent.

```
parent: prepare → invoke-plugin (EmbeddedDAGNode → child DAG) → finalize
child:  validate → transform
```

## Code

<<< @/../examples/derive.ts

## What it demonstrates

- **`DAGDeriver.from(contracts)`.** Accepts an array of `OperationContractType` objects. Each contract declares `name`, `hardRequired`, `produces`, `outputs`, and optional `annotations`. The deriver infers edges from the dependency graph.
- **`embeddedDAGs` annotation.** Overrides a placement to render as an `EmbeddedDAGNode` that runs a named sub-DAG. The deriver emits `{ '@type': 'EmbeddedDAGNode', dag: 'childDagName' }` for that placement.
- **Automatic rewiring.** Adding a new operation that produces a value another operation requires inserts a new edge automatically — no manual routing changes.
- **Companion to DAGBuilder.** Both paths produce equivalent DAG documents. `DAGDeriver` suits agentic flows where the operation set is the spec; `DAGBuilder` suits ETL and pipeline authoring where the topology is explicit.

## Run

```bash
npx tsx examples/derive.ts
```

Or via npm script:

```bash
npm run example:derive
```

See [Contract-derived flows](../guide/derive) for the full `OperationContractType` schema, annotation reference, and output validation.
