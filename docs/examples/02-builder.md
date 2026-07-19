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
import { archivistDAG } from '../exampleDags.ts';
</script>

# Example 02: DAGBuilder

## Builder Authoring Model

Example 02 shows the Archivist parent DAG authored with `DAGBuilder` instead of a hand-written object literal. The output is still the same JSON-LD DAG the dispatcher consumes; the builder only makes authoring safer and easier to review.
TypeScript stays in the authoring seam: route exhaustiveness, typed output names, auto-entrypoint selection, scatter placement options, embedded DAG mappings, and one final `.build()` that returns the canonical document. This is the guarded authoring path for teams that want stronger reviewability without inventing a second runtime format.

## Typed Routing and Placement API

The diagram below is generated from the built Archivist DAG, not from a separate drawing. Every `.node()`, `.embed()`, and `.scatter()` call in the source becomes a placement in the rendered graph and in the registered runtime document.

### DAG registration and diagram

The diagram is the same [Archivist](./the-archivist) parent DAG that the dispatcher consumes at runtime. `.build()` returns this JSON-LD document directly; there is no second runtime DSL or projection layer.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG authored via DAGBuilder beside Mermaid generated from it." />

### Run

```bash
npx tsx examples/the-archivist/runArchivist.ts
```

## Builder Emission Model

Each builder call appends a placement to the DAG document. The node instance supplies the output union, and the route object must cover that union. If a node can return `'retry'`, the route map needs a `'retry'` key. If it does not, TypeScript complains before registration, docs rendering, or execution begins.

`build()` freezes the assembly into a plain `DAG` value with a DAG IRI, placement IRIs, labeled `entrypoints`, and output targets. From that point forward, the builder disappears. Registration, serialization, visualization, plugins, and execution all see normal JSON-LD.

## Code Samples

This code is the builder-authored Archivist DAG. Read it as a route map first and TypeScript second: every chained call becomes one JSON-LD placement, and the final `.build()` returns the document rendered above.

### Code

The complete `archivistDAG`, the parent DAG as a single `DAGBuilder` chain. The full builder chain includes inline branches for reviews and describe (which use distinct post-scout ranking steps):

<<< @/../examples/the-archivist/dag.ts

## Operational Uses

`DAGBuilder` lets teams keep graph authoring close to the node implementations while still shipping a portable JSON-LD artifact. It is the right tool when the DAG lives in TypeScript source and reviewers need compile-time help with route coverage.

## Runtime Notes

The builder is deliberately not a second configuration language. There is no hidden builder runtime, no decorator metadata, and no post-build projection layer. The object returned by `.build()` is the document `registerDAG` validates.

That makes builder-authored DAGs easy to package as plugins: the plugin exports a normal DAG IRI or reference, and a parent flow embeds that reference exactly as it would embed a hand-authored DAG.

### Authoring contract
- **Fluent chainable authoring.** Every `.node()` and `.scatter()` returns `this` for fluent composition. The chain calls `build()` once at the end to produce the plain `DAG` object.
- **Compile-time route exhaustiveness.** The `routes` argument is typed as `Record<TOutput, null | string>`. TypeScript catches missing outputs (forgot `'error'`) and stray outputs (typo in output name) at compile time.
- **Auto-entrypoint.** The first `.node()` call sets the DAG entrypoint automatically. Override with `.entrypoints(...)` when multiple labels should enter the same graph, as Cartographer does for source intake.
- **Embedded-DAG placements via `.embed()`.** `on-topic-search`, `author-search`, `similar-search`, and `compose-loop` are `EmbeddedDAGNode` placements. Each references a registered sub-DAG by IRI and declares its `stateMapping.outputs`.
- **Scatter placements via `.scatter()`.** `reviews-scatter` and `describe-scatter` scatter over `state.bookWorksets` with a dynamic `DagReference` body. Each clone reads `item.dagIri`, validates it against explicit candidates, and executes the matching tool DAG; clone outputs then route into a first-class gather placement.
- **Same output as a literal `DAG`.** `.build()` returns the identical wire shape `DAGDocument.load(json)` validates. The builder is a convenience layer, not a separate runtime.

The builder-authored DAG above is the same document rendered and executed in [The Archivist](./the-archivist).

## Related Concepts

These related pages connect builder authoring, literal JSON-LD, embedded DAGs, and the reference shapes.

- [Running domain: The Archivist](./the-archivist)
- [DAGBuilder guide](../guide/builder)
- [Example 03: Tool Schemas](./03-schema) - the same topology loaded from a JSON file instead
- [Example 05: Embedded DAGs](./05-embedded-dags) - the embedded-DAG sub-DAG internals
- [Reference: Entities, `DAG`, `SingleNode`, `ScatterNode`](../reference/entities)
