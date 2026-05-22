---
seeAlso:

  - text: 'DAGBuilder'

    link: './builder'
    description: 'render anything `build()` returns'

  - text: 'Contract-derived flows'

    link: './derive'
    description: 'render the DAG `DAGDeriver.derive` produced'

  - text: 'Schema & JSON loading'

    link: './schema'
    description: 'render a DAG loaded from JSON'
---

# Visualization

`MermaidRenderer.render(dag)` emits Mermaid `flowchart` source for any `DAG`. Embed the output in Markdown, render via the Mermaid CLI, or feed to a Mermaid-aware viewer.

## Basic usage

```ts
import { MermaidRenderer } from '@noocodex/dagonizer/viz';

const source = MermaidRenderer.render(dispatcher.getDAG('pipeline')!);
console.log(source);
```

## Shape vocabulary

| Placement | Mermaid shape | Example output |
|-----------|---------------|----------------|
| `single`  | rectangle     | `greet[greet]` |
| `fan-out` | hexagon       | `scout{{scout}}` |
| `deep-dag` | stadium       | `enrich([enrich])` |
| `parallel`| subgraph      | `subgraph group["group (parallel)"]` … `end` |
| `terminal` (completed) | double-circle | `done(((done\n(completed))))` |
| `terminal` (failed) | asymmetric flag | `abort>abort\n(failed)]` |

Routes render as labeled directed edges. Routes targeting `null` route to a synthetic `END([end])` terminator (one per DAG).

**TerminalNode vs synthetic END:** A `TerminalNode` placement is declared explicitly in the DAG and renders as a named shape with an outcome suffix (`(completed)` or `(failed)`). The synthetic `END` node is implicit sugar emitted once when any non-terminal placement routes an output to `null`. Both can coexist in the same diagram: the `TerminalNode` shape represents the declared placement, and `END` captures the null routes from other placements. `TerminalNode` placements emit no outbound edges — they are leaf nodes by definition.

## Embedding in Markdown

```md
\`\`\`mermaid
{output of MermaidRenderer.render(dag)}
\`\`\`
```

The output is a complete Mermaid block ready to drop into a fenced code block.

## Combining with read accessors

```ts
const sources = dispatcher.listDAGs().map((dag) => ({
  name: dag.name,
  mermaid: MermaidRenderer.render(dag),
}));
```

The dispatcher's read accessors (`getDAG`, `listDAGs`, `getNode`, `listNodes`) make documentation generation straightforward — pull every registered DAG, render it, and write the markdown.
## Cytoscape element metadata

`CytoscapeRenderer.render(dag)` emits a plain element array consumable directly by `cytoscape.js`. Every node element carries a `data.type` field for stylesheet selectors.

| `data.type` | Source | Additional fields |
|-------------|--------|-------------------|
| `'single'` | `SingleNode` placement | `data.node` |
| `'fan-out'` | `FanOutNode` placement | `data.node`, `data.source`, `data.fanIn`, etc. |
| `'deep-dag'` | `DeepDAGNode` placement | `data.dag`, `data.stateMapping` |
| `'parallel'` | `ParallelNode` placement | `data.combine`, `data.children` |
| `'terminal'` | `TerminalNode` placement | `data.outcome: 'completed' \| 'failed'` |
| `'terminal'` | synthetic `END` node | `data.synthetic: true` |

User-declared `TerminalNode` placements and the synthetic `END` node both use `data.type === 'terminal'`. Distinguish them via `data.synthetic === true` (only set on the synthetic node) or `data.outcome` (only set on user-declared terminals).

## Related reference

- [Reference: Viz — `MermaidRenderer`](../reference/viz)
- [Reference: Dagonizer — read accessors `getDAG` / `listDAGs`](../reference/dagonizer)
