---
title: 'Visualization'
description: 'MermaidRenderer.render emits flowchart source; JsonLdRenderer.render emits JSON-LD; CytoscapeRenderer.render emits Cytoscape elements (the doc site uses this); DAGONIZER_VOCAB is the vocabulary base URI string.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'render anything `build()` returns'
  - text: 'Contract-derived flows'
    link: './derive'
    description: 'render the DAG `DAGDeriver.derive` produced'
  - text: 'Schema and JSON loading'
    link: './schema'
    description: 'render a DAG loaded from JSON'
---

<script setup lang="ts">
import { DAG_CONTEXT } from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';

const dag: DAG = {
  '@context': DAG_CONTEXT,
  '@id': 'urn:noocodex:dag:demo',
  '@type': 'DAG',
  name: 'demo',
  version: '1',
  entrypoint: 'a',
  nodes: [
    { '@id': 'urn:noocodex:dag:demo/node/a', '@type': 'SingleNode', name: 'a', node: 'noop', outputs: { success: 'b' } },
    { '@id': 'urn:noocodex:dag:demo/node/b', '@type': 'SingleNode', name: 'b', node: 'noop', outputs: { success: null } },
  ],
};
</script>

# Visualization

Three renderers ship in `@noocodex/dagonizer/viz`. Each consumes a `DAG` and emits a different surface: `MermaidRenderer.render` produces `flowchart` source for embedding in Markdown; `JsonLdRenderer.render` produces a JSON-LD document for graph databases and semantic tooling; `CytoscapeRenderer.render` produces a plain `readonly CytoscapeElement[]` array for consumers who manage their own cytoscape instance.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `MermaidRenderer.render(dag)` | `@noocodex/dagonizer/viz` | Returns Mermaid `flowchart` source |
| `JsonLdRenderer.render(dag)` | `@noocodex/dagonizer/viz` | Returns a `DagJsonLdDocument` |
| `CytoscapeRenderer.render(dag, options?)` | `@noocodex/dagonizer/viz` | Returns `readonly CytoscapeElement[]` (elements only; no positions) |
| `DAGONIZER_VOCAB` | `@noocodex/dagonizer/viz` | Vocabulary base URI string; classes appear as `dag:ClassName` in the `@context` |

## MermaidRenderer

<<< @/../examples/the-archivist/viz/render-mermaid.ts#mermaid-render

### Shape vocabulary

| Placement | Mermaid shape | Example output |
|-----------|---------------|----------------|
| `single`  | rectangle     | `greet[greet]` |
| `scatter` | trapezoid     | `scout[/scout/]` |
| `embedded-dag` | subroutine | `invoke[[invoke]]` |
| `terminal` (completed) | double-circle | `done(((done\n(completed))))` |
| `terminal` (failed) | asymmetric flag | `abort>abort\n(failed)]` |

Routes render as labeled directed edges. Routes targeting `null` route to a synthetic `END([end])` terminator (one per DAG).

### Containment coloring

Placements bound to a `container` role (`EmbeddedDAGNode` or dag-body `ScatterNode` with a non-empty `container` field) receive the Mermaid `contained` class, emitted via a `classDef contained` rule at the end of the flowchart. The fill color is amber-orange (`#f59e0b`) to read visually as "offloaded / running in an isolate". The `@type`-specific shape is preserved — a contained `EmbeddedDAGNode` remains a subroutine shape; a contained `ScatterNode` remains a trapezoid. In-process placements are unstyled (Mermaid default). The `contained` class is only emitted when at least one contained placement exists in the DAG.

**TerminalNode vs synthetic END.** A `TerminalNode` placement is declared explicitly in the DAG and renders as a named shape with an outcome suffix (`(completed)` or `(failed)`). The synthetic `END` node is implicit sugar emitted once when any non-terminal placement routes an output to `null`. Both can coexist in the same diagram: the `TerminalNode` shape represents the declared placement, and `END` captures the null routes from other placements. `TerminalNode` placements emit no outbound edges; they are leaf nodes by definition.

### Embedding in Markdown

````md
```mermaid
{output of MermaidRenderer.render(dag)}
```
````

The output is a complete Mermaid block ready to drop into a fenced code block.

## CytoscapeRenderer

`CytoscapeRenderer.render(dag, options?)` returns a plain `readonly CytoscapeElement[]` with NO positions. Positioning is performed separately by `CompositeLayout.compute` (async) or handled internally by the `CytoscapeGraph` factory. To use the cytoscape visualizer, install the optional peer dependencies:

```sh
npm install cytoscape @dagrejs/dagre
```

The package injects cytoscape (consumers pass the constructor to `CytoscapeGraph`) and lazy-loads `@dagrejs/dagre` internally. Neither peer is required for the non-cytoscape renderers.

<<< @/../examples/the-archivist/viz/render-cytoscape.ts#cytoscape-render

Pass an `embeddedDAGs` map to inline-expand `EmbeddedDAGNode` placements and `ScatterNode` placements whose `body` is a sub-DAG as compound nodes. The example above shows the Archivist's full embedded-DAG map.

The `options` object accepts only `embeddedDAGs` and `maxDepth`. The `computeLayout` and `layoutOptions` options are not accepted; layout is performed by `CompositeLayout.compute` or `CytoscapeGraph` internally.

### Cytoscape element metadata

Every node element carries a `data.type` field for stylesheet selectors.

| `data.type` | Source | Additional fields |
|-------------|--------|-------------------|
| `'single'` | `SingleNode` placement | `data.node` |
| `'scatter'` | `ScatterNode` placement | `data.body`, `data.source`, `data.gather`, etc. |
| `'embedded-dag'` | `EmbeddedDAGNode` placement | `data.dag`, `data.stateMapping` |
| `'terminal'` | `TerminalNode` placement | `data.outcome: 'completed' \| 'failed'` |
| `'terminal'` | synthetic `END` node | `data.synthetic: true` |

User-declared `TerminalNode` placements and the synthetic `END` node both use `data.type === 'terminal'`. Distinguish them via `data.synthetic === true` (only set on the synthetic node) or `data.outcome` (only set on user-declared terminals).

### Containment metadata

Placements bound to a `container` role carry an additional `data.container` field (the role string, e.g. `'cpu'`) and the extra CSS class `dag-contained` alongside the type class (`dag-scatter`, `dag-embedded-dag`, etc.). In-process placements omit `data.container` entirely.

Select contained nodes in Cytoscape stylesheets via:
- `.dag-contained` — class selector, matches any contained placement regardless of type
- `node[container]` — data selector, matches any node with a container role set
- `node[container="cpu"]` — data selector, matches a specific role

`CytoscapeGraph`'s built-in stylesheet applies an amber-orange border and label color (`#f59e0b`) to `.dag-contained` nodes so they are visually distinct from in-process placements out of the box. Subclasses that override `stylesheet()` should carry this rule forward or replace it with a custom containment style.

### Live rendering in the doc site

The doc site renders DAGs via `CytoscapeGraph`, the package-shipped subclassable factory. `DagGraph.vue` (the doc site component) extends `CytoscapeGraph`; the `:dag` prop passes the `DAG` object directly and `CytoscapeGraph` builds elements, computes layout, and mounts cytoscape internally. Embedded DAGs render collapsed by default; pass `:expand-all="true"` to expand them all.

<DagGraph :dag="dag" aria-label="Two-node demo DAG rendered via CytoscapeRenderer." />

The same factory drives every DAG diagram in this guide and in the [Phase demos](../examples/the-archivist).

## JsonLdRenderer

<<< @/../examples/the-archivist/viz/render-jsonld.ts#jsonld-render

The output is a `DagJsonLdDocument`: `@context`, `@id`, `@type`, `@graph` (one entry per placement). Useful when feeding to a triple store, an RDF reasoner, or a graph database that consumes JSON-LD natively. The vocabulary base URI is available as `DAGONIZER_VOCAB` and is printed by the example above.

Classes appear in the output as prefixed IRIs under the `dag:` prefix (e.g. `dag:ScatterNode`, `dag:EmbeddedDAGNode`), where `dag` resolves to `DAGONIZER_VOCAB` via the document's `@context`.

## Combining with read accessors

```ts
const sources = dispatcher.listDAGs().map((dag) => ({
  name: dag.name,
  mermaid: MermaidRenderer.render(dag),
}));
```

The dispatcher's read accessors (`getDAG`, `listDAGs`, `getNode`, `listNodes`) make documentation generation straightforward: pull every registered DAG, render it, write the markdown.

## Related reference

- [Reference: Viz](../reference/viz)
- [Reference: Dagonizer](../reference/dagonizer)
