---
seeAlso:

  - text: 'Reference: Dagonizer — read accessors'

    link: './dagonizer'

  - text: 'Reference: Entities — `DAG`'

    link: './entities'

  - text: 'Reference: Derive — `DAGDeriver.derive`'

    link: './derive'
---

# Viz

DAG visualization helpers. Ship through `@noocodex/dagonizer/viz`.

```ts
import {
  MermaidRenderer,
  JsonLdRenderer,
  CytoscapeRenderer,
  DAGONIZER_VOCAB,
} from '@noocodex/dagonizer/viz';
import type {
  DagJsonLdDocument,
  JsonLdGraphEntry,
  CytoscapeElement,
  CytoscapeNodeElement,
  CytoscapeEdgeElement,
} from '@noocodex/dagonizer/viz';
```

## MermaidRenderer

Static class.

```ts
class MermaidRenderer {
  static render(dag: DAG): string;
}
```

Render a `DAG` as Mermaid `flowchart` source. The output is a complete Mermaid block ready to embed in a Markdown ```` ```mermaid ```` fence.

### Shape vocabulary

| Placement | Mermaid shape | Example output |
|-----------|---------------|----------------|
| `single`  | rectangle     | `greet[greet]` |
| `fan-out` | hexagon       | `scout{{scout}}` |
| `deep-dag` | stadium       | `enrich([enrich])` |
| `parallel`| subgraph      | `subgraph group["group (parallel)"]` … `end` |

Every output route renders as a labeled directed edge: `from -->|outcome| to`. Routes targeting `null` route to a synthetic `END` terminator (one per DAG, rendered as `END([end])`).

### Example

```ts
import { Dagonizer } from '@noocodex/dagonizer';
import { MermaidRenderer } from '@noocodex/dagonizer/viz';

const source = MermaidRenderer.render(dispatcher.getDAG('pipeline')!);
```

```mermaid
flowchart LR
  %% pipeline (v1.0)
  classify
  classify[classify]
  classify -->|off-topic| END
  classify -->|success| plan
  plan[plan]
  plan -->|success| END
  END([end])
```

### Combining with the dispatcher's read accessors

```ts
const sources = dispatcher.listDAGs().map((dag) => ({
  name: dag.name,
  mermaid: MermaidRenderer.render(dag),
}));
```

`getDAG`, `listDAGs`, `getNode`, and `listNodes` give tooling everything it needs to walk the registry and emit per-DAG documentation.

---

## JsonLdRenderer

Static class.

```ts
class JsonLdRenderer {
  static render(dag: DAG): DagJsonLdDocument;
}
```

Renders a `DAG` as a JSON-LD document with a `@context` and a `@graph` containing the DAG root plus every placement, all typed against the Dagonizer vocabulary (`DAGONIZER_VOCAB`). The output is a plain object; serialize with `JSON.stringify`.

```ts
import { JsonLdRenderer } from '@noocodex/dagonizer/viz';

const doc = JsonLdRenderer.render(dispatcher.getDAG('pipeline')!);
await fs.writeFile('pipeline.jsonld', JSON.stringify(doc, null, 2));
```

### `DAGONIZER_VOCAB`

```ts
const DAGONIZER_VOCAB = 'https://noocodex.dev/ontology/dagonizer/';
```

Stable JSON-LD vocabulary URI for the Dagonizer DAG vocabulary. Prefixed as `dag:` in rendered documents.

### Types

```ts
interface DagJsonLdDocument {
  readonly '@context': Record<string, string>;
  readonly '@graph': readonly JsonLdGraphEntry[];
}

interface JsonLdGraphEntry {
  readonly '@id': string;
  readonly '@type': string;
  readonly [key: string]: unknown;
}
```

---

## CytoscapeRenderer

Static class.

```ts
class CytoscapeRenderer {
  static render(dag: DAG, options?: RenderOptions): readonly CytoscapeElement[];
}
```

Renders a `DAG` as a Cytoscape `elements` array. Pass the result directly to `cytoscape({ elements })`.

- Every placement becomes a node element with a `type` field (`'single'` | `'parallel'` | `'fan-out'` | `'deep-dag'` | `'terminal'`) for per-type stylesheet selectors.
- Every output route becomes a labeled edge element.
- Parallel children render with `parent: <parallelPlacementName>` for compound-graph rendering.
- Deep-DAG placements are expanded inline when their target DAG is supplied via `options.deepDags`, showing the full inner flow as a compound cluster.
- Routes to `null` become edges to a synthetic `END` terminal node.

```ts
import { CytoscapeRenderer } from '@noocodex/dagonizer/viz';

const elements = CytoscapeRenderer.render(dag, {
  deepDags: new Map([['inner-dag', innerDag]]),
  maxDepth: 4,
});
```

### `RenderOptions`

```ts
interface RenderOptions {
  readonly deepDags?: ReadonlyMap<string, DAG>;
  readonly maxDepth?: number;   // default 6
}
```

### Types

```ts
type CytoscapeElement = CytoscapeNodeElement | CytoscapeEdgeElement;

interface CytoscapeNodeElement {
  readonly group: 'nodes';
  readonly data: {
    readonly id: string;
    readonly label: string;
    readonly type: 'single' | 'parallel' | 'fan-out' | 'deep-dag' | 'terminal';
    readonly [key: string]: unknown;
  };
  readonly classes?: string;
}

interface CytoscapeEdgeElement {
  readonly group: 'edges';
  readonly data: {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly label: string;
    readonly route: string;
  };
  readonly classes?: string;
}
```

## Related guides

- [Visualization](../guide/visualization)
- [Contract-derived flows](../guide/derive)
- [DAGBuilder](../guide/builder)
