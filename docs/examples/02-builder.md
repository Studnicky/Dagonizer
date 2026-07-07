---
title: 'Example 02: DAGBuilder'
description: 'The Archivist parent DAG authored with the chainable DAGBuilder API. Compile-time route exhaustiveness, scatter placements, auto-entrypoint, one fluent chain.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'DAGBuilder guide'
    link: '../guide/builder'
  - text: 'Example 03: Tool Schemas'
    link: './03-schema'
    description: 'the same topology loaded from a JSON file instead'
  - text: 'Example 05: Embedded DAGs'
    link: './05-embedded-dags'
    description: 'the embedded-DAG sub-DAG internals'
  - text: 'Reference: Entities, `DAG`, `SingleNode`, `ScatterNode`'
    link: '../reference/entities'
---

<script setup lang="ts">
import { archivistDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 02: DAGBuilder

## What It Is

Example 02 shows the Archivist parent DAG authored with `DAGBuilder` instead of a hand-written object literal. The output is still the same JSON-LD DAG the dispatcher consumes; the builder only makes authoring safer and easier to review.

Use this page when you want TypeScript to help with graph assembly: route exhaustiveness, typed output names, auto-entrypoint selection, scatter placement options, embedded DAG mappings, and one final `.build()` that returns the canonical document.

## How It Works

Each builder call appends a placement to the DAG document. The node instance supplies the output union, and the route object must cover that union. If a node can return `'retry'`, the route map needs a `'retry'` key. If it does not, TypeScript complains before the docs, tests, or browser demo get involved.

`build()` freezes the assembly into a plain `DAG` value with `@context`, `@type` placements, `entrypoint`, and output targets. From that point forward, the builder disappears. Registration, serialization, visualization, plugins, and execution all see normal JSON-LD.

## Diagrams, Examples, and Outputs

The diagram below is generated from the built Archivist DAG, not from a separate drawing. That matters: every `.node()`, `.embed()`, and `.scatter()` call in the source has a corresponding shape in the rendered graph.

### DAG registration and diagram

The diagram is the same [Archivist](./the-archivist) parent DAG that the dispatcher consumes at runtime. `.build()` returns this JSON-LD document directly; there is no second runtime DSL or projection layer.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG authored via DAGBuilder beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## What It Lets You Do

`DAGBuilder` lets teams keep graph authoring close to the node implementations while still shipping a portable JSON-LD artifact. It is the right tool when the DAG lives in TypeScript source and reviewers need compile-time help with route coverage.

## Code Samples

This code is the builder-authored Archivist DAG. Read it as a route map first and TypeScript second: every chained call becomes one JSON-LD placement, and the final `.build()` returns the document rendered above.

### Code

The complete `archivistDAG`, the parent DAG as a single `DAGBuilder` chain. The full source file includes inline branches for reviews and describe (which use distinct post-scout ranking steps):

<<< @/../examples/the-archivist/dag.ts

## Details for Nerds

The builder is deliberately not a second configuration language. There is no hidden builder runtime, no decorator metadata, and no post-build projection layer. The object returned by `.build()` is the document `registerDAG` validates.

That makes builder-authored DAGs easy to package as plugins: the plugin exports a normal DAG name, and a parent flow embeds that name exactly as it would embed a hand-authored DAG.

### What it demonstrates
- **Fluent chainable authoring.** Every `.node()` and `.scatter()` returns `this` for fluent composition. The chain calls `build()` once at the end to produce the plain `DAG` object.
- **Compile-time route exhaustiveness.** The `routes` argument is typed as `Record<TOutput, null | string>`. TypeScript catches missing outputs (forgot `'error'`) and stray outputs (typo in output name) at compile time.
- **Auto-entrypoint.** The first `.node()` call (`'recall-context'`) sets the DAG entrypoint automatically. Override with `.entrypoint(name)` if needed.
- **Embedded-DAG placements via `.embed()`.** `on-topic-search`, `author-search`, `similar-search`, and `compose-loop` are `EmbeddedDAGNode` placements. Each references a registered sub-DAG by name and declares its `stateMapping.outputs`.
- **Scatter placements via `.scatter()`.** `reviews-scatter` and `describe-scatter` scatter over a descriptor source (`state.scoutProviders`) with a dispatching body node. Each clone reads `state.metadata.currentItem` and executes the matching scout logic; four sources run concurrently with `execution: { mode: 'item', concurrency: 4 }`.
- **Same output as a literal `DAG`.** `.build()` returns the identical wire shape `Dagonizer.load()` expects. The builder is a convenience layer, not a separate runtime.

See this in action in the [Archivist live demo](./the-archivist).

## Related Concepts

Read these next when you want to move between builder authoring, literal JSON-LD, embedded DAGs, and the reference shapes.

- [Running domain: The Archivist](./the-archivist)
- [DAGBuilder guide](../guide/builder)
- [Example 03: Tool Schemas](./03-schema) - the same topology loaded from a JSON file instead
- [Example 05: Embedded DAGs](./05-embedded-dags) - the embedded-DAG sub-DAG internals
- [Reference: Entities, `DAG`, `SingleNode`, `ScatterNode`](../reference/entities)
