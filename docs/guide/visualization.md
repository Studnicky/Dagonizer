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
| `sub-dag` | stadium       | `enrich([enrich])` |
| `parallel`| subgraph      | `subgraph group["group (parallel)"]` … `end` |

Routes render as labeled directed edges. Routes targeting `null` route to a synthetic `END([end])` terminator (one per DAG).

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

## See also

- [DAGBuilder](./builder) — render anything `build()` returns
- [Contract-derived flows](./derive) — render the DAG `FlowDeriver.derive` produced
- [Schema & JSON loading](./schema) — render a DAG loaded from JSON

## Related reference

- [Reference: Viz — `MermaidRenderer`](../reference/viz)
- [Reference: Dagonizer — read accessors `getDAG` / `listDAGs`](../reference/dagonizer)
