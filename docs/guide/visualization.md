---
title: 'Visualization'
description: 'MermaidRenderer.render emits flowchart source; JsonLdRenderer.render emits JSON-LD; CytoscapeRenderer.render emits Cytoscape elements (the doc site uses this); DAGONIZER_VOCAB is the vocabulary base URI string.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'render anything `build()` returns'
  - text: 'Schema and JSON loading'
    link: './schema'
    description: 'render a DAG loaded from JSON'
---

<script setup lang="ts">
import { archivistDAG } from '../exampleDags.ts';
</script>

# Visualization

## Rendering Surface

Visualization turns the canonical DAG document into three concrete outputs: Mermaid for docs, JSON-LD for semantic graph tooling, and Cytoscape element data for live runtime views.

The input is always the same `DAG` object the dispatcher registers. Rendering never invents a second graph model.

## Rendered Outputs

JSON-LD and Mermaid stay side by side so the DAG document and rendered topology stay easy to compare. Interactive hosts use Cytoscape because they need live execution state.

<DagJsonMermaid :dag="archivistDAG" title="The Archivist parent DAG" aria-label="The Archivist JSON-LD DAG beside Mermaid generated from it." />

- [DAGBuilder](./builder) - render anything `build()` returns
- [Schema and JSON loading](./schema) - render a DAG loaded from JSON
- [The Archivist](../examples/the-archivist) - Cytoscape view for a registered DAG with live state
- [The Cartographer](../examples/the-cartographer) - Cytoscape view for scatter, workers, and streaming
- [The Dispatcher](../examples/the-dispatcher) - Cytoscape view for routing and handoff

## Renderer Contracts

Each renderer consumes the same `DAG` document. `MermaidRenderer` emits flowchart source, `JsonLdRenderer` emits semantic JSON-LD, and `CytoscapeRenderer` emits element data for hosts that manage their own graph component and styling.

Three renderers ship in `@studnicky/dagonizer/viz`. Each consumes a `DAG` and emits a different output: `MermaidRenderer.render` produces `flowchart` source for embedding in Markdown; `JsonLdRenderer.render` produces a JSON-LD document for graph databases and semantic tooling; `CytoscapeRenderer.render` produces a plain `readonly CytoscapeElementType[]` array for hosts that manage their own cytoscape instance.

## Code Samples

The code samples cover each renderer output and the metadata it emits.

### API

| Symbol | Source | Role |
|--------|--------|------|
| `MermaidRenderer.render(dag)` | `@studnicky/dagonizer/viz` | Returns Mermaid `flowchart` source |
| `JsonLdRenderer.render(dag)` | `@studnicky/dagonizer/viz` | Returns a `DagJsonLdDocumentType` |
| `CytoscapeRenderer.render(dag, options?)` | `@studnicky/dagonizer/viz` | Returns `readonly CytoscapeElementType[]` (elements only; no positions) |
| `DAGONIZER_VOCAB` | `@studnicky/dagonizer/viz` | Vocabulary base URI string; classes appear as `dag:ClassName` in the `@context` |

## Operational Uses

Visualization correlates the canonical JSON-LD DAG with a graph rendering. Docs and guide pages use Mermaid; interactive hosts use Cytoscape for live execution state.

## Runtime Notes

### MermaidRenderer

<<< @/../examples/the-archivist/viz/render-mermaid.ts#mermaid-render

#### Shape vocabulary

| Placement | Mermaid shape | Example output |
|-----------|---------------|----------------|
| `single`  | rectangle     | `greet["greet"]` |
| `scatter` | trapezoid     | `scout[/"scout"/]` |
| `embedded-dag` | subroutine | `invoke[["invoke"]]` |
| `terminal` (completed) | double-circle | `done((("done")))` |
| `terminal` (failed) | asymmetric flag | `abort>"abort"]` |

Routes render as labeled directed edges.

`MermaidRenderer.render(dag, { theme })` also accepts visual parameters. Use `fontFamily`, `fontSize`, `nodeSpacing`, `rankSpacing`, and `padding` to drive Mermaid layout, and use `primaryColor`, `lineColor`, `textColor`, `background`, and `containerTints` to control emitted colors.

#### Containment coloring

Placements bound to a `container` role (`EmbeddedDAGNode` or dag-body `ScatterNode` with a non-empty `container` field) each receive a per-role Mermaid class (`contained-<role>`) whose fill and stroke come from a deterministic palette keyed on the role string. A DAG with two distinct roles (e.g. `cpu` and `io`) emits two `classDef contained-cpu …` and `classDef contained-io …` rules with different colors, then assigns each placement to its role-specific class. The `@type`-specific shape is preserved — a contained `EmbeddedDAGNode` remains a subroutine shape; a contained `ScatterNode` remains a trapezoid. In-process placements are unstyled (Mermaid default). `classDef` rules are omitted entirely when no contained placement exists in the DAG.

**TerminalNode rendering.** A `TerminalNode` placement renders as a named shape with an outcome suffix (`(completed)` or `(failed)`). Completed terminals use a double-circle shape; failed terminals use an asymmetric flag. `TerminalNode` placements emit no outbound edges; they are leaf nodes by definition.

#### Embedding in Markdown

````md
```mermaid
{output of MermaidRenderer.render(dag)}
```
````

The output is a complete Mermaid block ready to drop into a fenced code block.

### CytoscapeRenderer

`CytoscapeRenderer.render(dag, options?)` returns a plain `readonly CytoscapeElementType[]` with NO positions. Positioning is performed separately by `CompositeLayout.compute` (async) or handled internally by the `CytoscapeGraph` factory. To use the cytoscape visualizer, install the optional peer dependencies:

```sh
npm install cytoscape @dagrejs/dagre
```

The package injects cytoscape (hosts pass the constructor to `CytoscapeGraph`) and lazy-loads `@dagrejs/dagre` internally. Neither peer is required for the non-cytoscape renderers.

<<< @/../examples/the-archivist/viz/render-cytoscape.ts#cytoscape-render

Pass an `embeddedDAGs` map to inline-expand `EmbeddedDAGNode` placements and `ScatterNode` placements whose `body` is a sub-DAG as compound nodes. The example above shows the Archivist's full embedded-DAG map.

The `options` object accepts only `embeddedDAGs` and `maxDepth`. The `computeLayout` and `layoutOptions` options are not accepted; layout is performed by `CompositeLayout.compute` or `CytoscapeGraph` internally.

#### Cytoscape element metadata

Every node element carries a `data.type` field for stylesheet selectors.

| `data.type` | Source | Additional fields |
|-------------|--------|-------------------|
| `'single'` | `SingleNode` placement | `data.node` |
| `'scatter'` | `ScatterNode` placement | `data.body`, `data.source`, `data.gather`, etc. |
| `'embedded-dag'` | `EmbeddedDAGNode` placement | `data.dag`, `data.stateMapping` |
| `'terminal'` | `TerminalNode` placement | `data.outcome: 'completed' \| 'failed'` |
| `'terminal'` | synthetic `END` node | `data.synthetic: true` |
| `'phase'` | `PhaseNode` placement | `data.phase: 'pre' \| 'post'`, `data.node` |

User-declared `TerminalNode` placements and the synthetic `END` node both use `data.type === 'terminal'`. Distinguish them via `data.synthetic === true` (only set on the synthetic node) or `data.outcome` (only set on user-declared terminals).

#### Containment metadata

Placements bound to a `container` role carry an additional `data.container` field (the role string, e.g. `'cpu'`) and the extra CSS class `dag-contained` alongside the type class (`dag-scatter`, `dag-embedded-dag`, etc.). In-process placements omit `data.container` entirely.

Select contained nodes in Cytoscape stylesheets via:
- `.dag-contained` — class selector, matches any contained placement regardless of type
- `node[container]` — data selector, matches any node with a container role set
- `node[container="cpu"]` — data selector, matches a specific role

`CytoscapeGraph`'s built-in stylesheet applies per-role colors to `.dag-contained` nodes via cytoscape `data(...)` mapping — `background-color: data(containerColor)`, `border-color: data(containerStroke)`, `color: data(containerText)` — so each distinct container role renders with its own palette. The colors are written to node data by `CytoscapeRenderer` and driven by the same `RoleColorUtils.forRole` palette as the Mermaid renderer. Subclasses that override `stylesheet()` should carry this rule forward or replace it with a custom containment style.

#### Static and interactive rendering

Mermaid fits static references where the registered JSON-LD and rendered topology should stay adjacent. Cytoscape fits interactive hosts that need live execution state, expansion, and richer runtime navigation in [The Archivist](../examples/the-archivist), [The Cartographer](../examples/the-cartographer), and [The Dispatcher](../examples/the-dispatcher).

### JsonLdRenderer

<<< @/../examples/the-archivist/viz/render-jsonld.ts#jsonld-render

The output is a `DagJsonLdDocumentType`: `@context`, `@id`, `@type`, `@graph` (one entry per placement). Useful when feeding to a triple store, an RDF reasoner, or a graph database that consumes JSON-LD natively. The vocabulary base URI is available as `DAGONIZER_VOCAB` and is printed by the example above.

Classes appear in the output as prefixed IRIs under the `dag:` prefix (e.g. `dag:ScatterNode`, `dag:EmbeddedDAGNode`), where `dag` resolves to `DAGONIZER_VOCAB` via the document's `@context`.

### Combining with read accessors

<<< @/../examples/the-archivist/viz/render-mermaid.ts#list-dags-render

The dispatcher's read accessors (`getDAG`, `listDAGs`, `getNode`, `listNodes`) give registry-walking tooling a direct path: enumerate every registered DAG, render it, and emit the reference or artifact you need.

## Related Concepts

- [DAGBuilder](./builder) - render anything `build()` returns
- [Schema and JSON loading](./schema) - render a DAG loaded from JSON
- [The Archivist](../examples/the-archivist)
- [The Cartographer](../examples/the-cartographer)
- [The Dispatcher](../examples/the-dispatcher)
- [Reference: Visualization](../reference/viz)
- [Reference: Dagonizer](../reference/dagonizer)
