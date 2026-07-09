---
title: 'Example 27: Runtime DAG Dispatch'
description: 'The Archivist uses a dynamic DagReference on a scatter body so each workset resolves its embedded tool DAG at runtime from item state.'
seeAlso:
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
    description: 'the stateMapping.input / stateMapping.output pattern'
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'parallel fan-out with embedded DAG bodies'
  - text: 'Example 26: Tool Use'
    link: './26-tool-use'
    description: 'Archivist tool registry and search DAGs'
  - text: 'Reference: Execution'
    link: '../reference/execution'
---

<script setup lang="ts">
import { BookSearchScatterDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 27: Runtime DAG Dispatch

## What It Is

Runtime DAG Dispatch lets one placement choose a registered child DAG from state or item data at execution time. The Archivist uses a dynamic `DagReference` inside its book-search scatter so each workset can run the tool DAG referenced by that item.

This is the embedding interface for heterogeneous work. The parent graph stays stable, while data selects whether a clone runs Open Library search, Google Books search, Wikipedia enrichment, or another registered tool flow.

## How It Works

A dynamic `DagReference` names a source (`state` or `item`), a dotted path, and the finite candidate DAG set. For each clone, the dispatcher reads that path, expands the value through the DAG registry, validates that it is one of the declared candidates, and executes it as the clone body. Parent topology stays stable while item data selects the concrete child flow.

Because lookup goes through the registry, runtime dispatch still has a closed world: only registered DAGs can execute. That keeps plugin-provided flows and local flows on the same assembly surface.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The [Archivist](./the-archivist) uses a dynamic `DagReference` in its book-search scatter. `build-book-worksets` prepares worksets where each item carries the registered tool DAG reference. The scatter then resolves the embedded body from item state at runtime, so the same placement can fan out to Open Library, Google Books, Wikipedia, or subject search without a plugin-specific node type.

<DagJsonMermaid :dag="BookSearchScatterDAG" title="Archivist runtime DagReference scatter" aria-label="Archivist runtime DagReference JSON-LD DAG beside Mermaid generated from it." />

This is the production shape behind recursive or heterogeneous embedded calls:

- The parent DAG registers all candidate child DAGs once.
- Each scattered item provides a `dagIri`.
- The scatter body declares `{ dag: { from: 'item', path: 'dagIri', candidates: [...] } }`.
- The engine resolves the child DAG from the registry for that item.
- State mapping keeps child work isolated and copies only declared outputs back.

### Run

```bash
npm run docs:dev
```

Open [The Archivist](./the-archivist) and ask a book question that needs external search or tool-backed lookup.

## What It Lets You Do

Runtime DAG dispatch lets applications select an embedded child DAG from state at execution time. Use it when one placement fans out heterogeneous work items, plugin-provided DAGs, or tool-specific flows that share the same parent scatter and gather contract.

This is also the bridge between plugins and embedding: if a plugin registers a DAG IRI/reference, a host DAG can place it statically with a literal `dag` or select it dynamically with a `DagReference`.

## Code Samples

The embedded DAG owns runtime DAG-reference resolution:

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

The browser demo registers the same tool DAGs before registering the parent Archivist DAG:

<<< @/../docs/.vitepress/theme/components/ArchivistRunner.vue#archivist-browser-tool-registry

## Details for Nerds

- **Runtime child selection.** `DagReference` reads the child DAG reference from state or item data instead of baking one literal `dag` string into the placement.
- **One placement, many bodies.** The graph has one scatter placement even though different items can execute different registered DAGs.
- **Registry as assembly boundary.** Tool DAGs are registered before the parent DAG, so JSON-LD stays canonical and runtime lookup is deterministic.
- **Embedded isolation.** Each item runs in a child state; declared outputs merge back into the parent workset flow.

## Related Concepts

- [Example 05: Embedded DAGs](./05-embedded-dags) - the stateMapping.input / stateMapping.output pattern
- [Example 04: Scatter Scout](./04-scatter) - parallel fan-out with embedded DAG bodies
- [Example 26: Tool Use](./26-tool-use) - Archivist tool registry and search DAGs
- [Reference: Execution](../reference/execution)
