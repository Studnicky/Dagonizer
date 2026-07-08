---
title: 'Example 04B: Scatter Collect'
description: "ScatterNode generate-and-select pattern: map gather collects each clone's produced candidate into a parent-state array in source-index order."
seeAlso:
  - text: 'Example 04: Scatter Scout'
    link: './04-scatter'
    description: 'scatter mechanics: source, body, gather, reduce'
  - text: 'Example 04C: Container-Bound Scatter'
    link: './04c-scatter-workers'
    description: 'bind a container role to a scatter placement'
  - text: 'Example 14: Gather strategies'
    link: './14-gather-strategies'
    description: 'collect vs discard side-by-side'
  - text: 'Reference: Core, GatherStrategies'
    link: '../reference/core'
---

<script setup lang="ts">
import { BookSearchScatterDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 04B: Scatter Collect

## What It Is

Scatter Collect is the "every clone brings something back" half of scatter. The Archivist sends tool worksets into a scatter branch, each clone produces candidate books, and the parent receives one ordered collection for ranking.

This page narrows in on the gather contract. The scatter can finish clones in any order, but `collect` writes results in source-index order so downstream code gets stable state instead of timing-dependent state.

## How It Works

The scatter source creates one clone per workset. Each clone runs the body DAG, writes its output into clone state, and returns a named outcome. The `collect` gather strategy copies the selected clone output into a parent array in source-index order, so downstream ranking sees stable input even when clone execution finishes out of order.

That ordering matters in real applications. A result from a slow provider should not jump ahead of a faster provider just because the network happened to answer later; selection logic should compare data, not race conditions.

## Diagrams, Examples, and Outputs

### DAG registration and diagram

The in-browser owner is [The Archivist](./the-archivist): its `book-search-scatter` sub-DAG scatters tool worksets, gathers candidate arrays back into the parent clone, and then ranks the collected candidates. This is the live Archivist graph, not a separate miniature.

<DagJsonMermaid :dag="BookSearchScatterDAG" title="book-search-scatter" aria-label="Archivist book-search-scatter JSON-LD DAG beside Mermaid generated from it." />

A `ScatterNode` runs a body DAG over every tool workset; each clone produces candidates through the `collect` gather strategy. The parent clone sees one candidate collection per workset when the scatter completes.

The generate-and-select pattern is common in LLM pipelines: scatter over a set of prompts or queries, each clone generates one candidate, and the parent picks from the collected array.

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## What It Lets You Do

Scatter collect lets applications run many clones concurrently and then continue with a deterministic parent-state collection. Use it for generate-and-select flows: ask several providers, tools, prompts, or strategies for candidates, then rank or merge the gathered outputs once all relevant clones finish.

The application-facing value is simple: the parent DAG still looks linear after the scatter. Ranking, merging, auditing, or response composition can treat gathered candidates as ordinary state while Dagonizer handles clone lifecycle and ordering.

## Code Samples

The same `BookSearchScatterDAG` drives the Archivist demo and the Mermaid diagram above. Read the scatter placement and gather declaration together; the JSON-LD is the contract the runtime enforces.

<<< @/../examples/the-archivist/embedded-dags/BookSearchScatterDAG.ts

## Details for Nerds

- **`collect` gather strategy.** Each clone writes its candidate list back to the parent clone's `candidates` collection.
- **Scatter body DAG.** The `body` uses a dynamic `DagReference`, so each workset chooses a registered tool DAG at runtime from an explicit candidate set.
- **`any-success` outcome reducer.** A single successful provider is enough for the search branch to continue.
- **Source-index mental model.** The parent sees deterministic gathered state even though provider work runs concurrently.

## Related Concepts

- [Example 04: Scatter Scout](./04-scatter) - scatter mechanics: source, body, gather, reduce
- [Example 04C: Container-Bound Scatter](./04c-scatter-workers) - bind a container role to a scatter placement
- [Example 14: Gather strategies](./14-gather-strategies) - collect vs discard side-by-side
- [Reference: Core, GatherStrategies](../reference/core)
