---
title: 'Visualization'
description: 'MermaidRenderer.render emits flowchart source; JsonLdRenderer.render emits JSON-LD; CytoscapeRenderer.render emits Cytoscape elements (the doc site uses this); DAGONIZER_VOCAB lists the JSON-LD class IRIs.'
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
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { ElementDefinition } from 'cytoscape';
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

const elements = CytoscapeRenderer.render(dag) as ElementDefinition[];
</script>

# Visualization

Three renderers ship in `@noocodex/dagonizer/viz`. Each consumes a `DAG` and emits a different surface: `MermaidRenderer.render` produces `flowchart` source for embedding in Markdown; `JsonLdRenderer.render` produces a JSON-LD document for graph databases and semantic tooling; `CytoscapeRenderer.render` produces a `cytoscape.js` element array, the format the doc site's live `<DagGraph>` component consumes.

## API surface

| Symbol | Source | Role |
|--------|--------|------|
| `MermaidRenderer.render(dag)` | `@noocodex/dagonizer/viz` | Returns Mermaid `flowchart` source |
| `JsonLdRenderer.render(dag)` | `@noocodex/dagonizer/viz` | Returns a `DagJsonLdDocument` |
| `CytoscapeRenderer.render(dag, options?)` | `@noocodex/dagonizer/viz` | Returns `readonly CytoscapeElement[]` |
| `DAGONIZER_VOCAB` | `@noocodex/dagonizer/viz` | JSON-LD class IRIs (`DAG`, `SingleNode`, etc.) |

## MermaidRenderer

```ts
import { MermaidRenderer } from '@noocodex/dagonizer/viz';

const source = MermaidRenderer.render(dispatcher.getDAG('pipeline')!);
console.log(source);
```

### Shape vocabulary

| Placement | Mermaid shape | Example output |
|-----------|---------------|----------------|
| `single`  | rectangle     | `greet[greet]` |
| `fan-out` | hexagon       | `scout{{scout}}` |
| `embedded-dag` | stadium  | `enrich([enrich])` |
| `parallel`| subgraph      | `subgraph group["group (parallel)"]` ... `end` |
| `terminal` (completed) | double-circle | `done(((done\n(completed))))` |
| `terminal` (failed) | asymmetric flag | `abort>abort\n(failed)]` |

Routes render as labeled directed edges. Routes targeting `null` route to a synthetic `END([end])` terminator (one per DAG).

**TerminalNode vs synthetic END.** A `TerminalNode` placement is declared explicitly in the DAG and renders as a named shape with an outcome suffix (`(completed)` or `(failed)`). The synthetic `END` node is implicit sugar emitted once when any non-terminal placement routes an output to `null`. Both can coexist in the same diagram: the `TerminalNode` shape represents the declared placement, and `END` captures the null routes from other placements. `TerminalNode` placements emit no outbound edges; they are leaf nodes by definition.

### Embedding in Markdown

````md
```mermaid
{output of MermaidRenderer.render(dag)}
```
````

The output is a complete Mermaid block ready to drop into a fenced code block.

## CytoscapeRenderer (used by the doc site)

`CytoscapeRenderer.render(dag)` emits a plain element array consumable directly by `cytoscape.js`. The doc site's `<DagGraph>` component wraps `cytoscape` plus an FSM that animates live runs; every DAG diagram in these docs is a `<DagGraph>` driven by `CytoscapeRenderer`.

```ts
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';
import type { ElementDefinition } from 'cytoscape';

const elements = CytoscapeRenderer.render(dag) as ElementDefinition[];
```

Pass an `embeddedDAGs` map to inline-expand `EmbeddedDAGNode` placements as compound nodes:

```ts
const elements = CytoscapeRenderer.render(parentDag, {
  embeddedDAGs: new Map([['child-dag', childDag]]),
}) as ElementDefinition[];
```

### Cytoscape element metadata

Every node element carries a `data.type` field for stylesheet selectors.

| `data.type` | Source | Additional fields |
|-------------|--------|-------------------|
| `'single'` | `SingleNode` placement | `data.node` |
| `'fan-out'` | `FanOutNode` placement | `data.node`, `data.source`, `data.fanIn`, etc. |
| `'embedded-dag'` | `EmbeddedDAGNode` placement | `data.dag`, `data.stateMapping` |
| `'parallel'` | `ParallelNode` placement | `data.combine`, `data.children` |
| `'terminal'` | `TerminalNode` placement | `data.outcome: 'completed' \| 'failed'` |
| `'terminal'` | synthetic `END` node | `data.synthetic: true` |

User-declared `TerminalNode` placements and the synthetic `END` node both use `data.type === 'terminal'`. Distinguish them via `data.synthetic === true` (only set on the synthetic node) or `data.outcome` (only set on user-declared terminals).

### Live rendering in the doc site

A `<DagGraph>` block takes a CytoscapeRenderer output and renders it inline:

<DagGraph :elements="elements" aria-label="Two-node demo DAG rendered via CytoscapeRenderer." />

The same renderer drives every DAG diagram in this guide and in the [Phase demos](../examples/the-archivist).

## JsonLdRenderer

```ts
import { JsonLdRenderer } from '@noocodex/dagonizer/viz';

const document = JsonLdRenderer.render(dag);
```

The output is a `DagJsonLdDocument`: `@context`, `@id`, `@type`, `@graph` (one entry per placement). Useful when feeding to a triple store, an RDF reasoner, or a graph database that consumes JSON-LD natively. The IRIs follow `DAGONIZER_VOCAB`:

```ts
import { DAGONIZER_VOCAB } from '@noocodex/dagonizer/viz';

DAGONIZER_VOCAB.DAG;          // 'urn:noocodex:vocab:DAG'
DAGONIZER_VOCAB.SingleNode;   // 'urn:noocodex:vocab:SingleNode'
// ...one IRI per class
```

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
