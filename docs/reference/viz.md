---
seeAlso:
  - text: 'Reference: Dagonizer'
    link: './dagonizer'
    description: 'read accessors'
  - text: 'Reference: Entities'
    link: './entities'
    description: '`DAG`'
  - text: 'Reference: Derive'
    link: './derive'
    description: 'render the DAG `derive()` returned'
---

# Viz

DAG visualization helpers. Ship through `@studnicky/dagonizer/viz`.

```ts twoslash
import {
  MermaidRenderer,
  JsonLdRenderer,
  CytoscapeRenderer,
  DAGONIZER_VOCAB,
} from '@studnicky/dagonizer/viz';
import type {
  DagJsonLdDocument,
  JsonLdGraphEntry,
  CytoscapeElement,
  CytoscapeNodeElement,
  CytoscapeEdgeElement,
} from '@studnicky/dagonizer/viz';

export {};
```

## MermaidRenderer

Static class.

```ts twoslash
import { MermaidRenderer } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const dag: DAG;
const mermaid: string = MermaidRenderer.render(dag);
```

Render a `DAG` as Mermaid `flowchart` source. The output is a complete Mermaid block ready to embed in a Markdown ```` ```mermaid ```` fence.

### Shape vocabulary

| Placement | Mermaid shape | Example output |
|-----------|---------------|----------------|
| `single`  | rectangle     | `greet[greet]` |
| `scatter` | trapezoid     | `scout[/scout/]` |
| `embedded-dag` | subroutine | `invoke[[invoke]]` |
| `terminal` (completed) | double-circle | `done(((done\n(completed))))` |
| `terminal` (failed) | asymmetric flag | `fail>fail\n(failed)]` |

Every output route renders as a labeled directed edge: `from -->|outcome| to`. Flows terminate at explicit `TerminalNode` placements, which render as double-circle (completed) or asymmetric-flag (failed) shapes and emit no outbound edges.

### Containment coloring

Placements with a non-empty `container` role each receive a per-role Mermaid class (`contained-<role>`) whose fill and stroke come from `RoleColorUtils.forRole`. One `classDef contained-<role>` rule is emitted per distinct role that appears in the DAG, so two different roles produce two distinct fill/stroke colors. The `@type`-derived shape is unchanged — only the color dimension signals containment. In-process placements receive no class. `classDef` rules are omitted entirely when no contained placement exists.

### Example

```ts
<<< @/../examples/the-archivist/viz/render-mermaid.ts#mermaid-render
```

```mermaid
flowchart LR
  %% pipeline (v1.0)
  classify[classify]
  classify -->|off-topic| end_off_topic
  classify -->|success| plan
  plan[plan]
  plan -->|success| end_done
  end_off_topic(((end_off_topic\n(completed))))
  end_done(((end_done\n(completed))))
```

### Combining with the dispatcher's read accessors

```ts twoslash
import { Dagonizer, NodeStateBase } from '@studnicky/dagonizer';
import { MermaidRenderer } from '@studnicky/dagonizer/viz';
class MyState extends NodeStateBase {}
// ---cut---
const dispatcher = new Dagonizer<MyState>();
const sources = dispatcher.listDAGs().map((dag) => ({
  name: dag.name,
  mermaid: MermaidRenderer.render(dag),
}));
```

`getDAG`, `listDAGs`, `getNode`, and `listNodes` give tooling everything it needs to walk the registry and emit per-DAG documentation.

---

## JsonLdRenderer

Static class.

```ts twoslash
import { JsonLdRenderer } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
import type { DagJsonLdDocument } from '@studnicky/dagonizer/viz';
// ---cut---
declare const dag: DAG;
const doc: DagJsonLdDocument = JsonLdRenderer.render(dag);
```

Renders a `DAG` as a JSON-LD document with a `@context` and a `@graph` containing the DAG root plus every placement, all typed against the Dagonizer vocabulary (`DAGONIZER_VOCAB`). The output is a plain object; serialize with `JSON.stringify`.

Each placement's `@type` is prefixed with `dag:`: `dag:SingleNode`, `dag:ScatterNode`, `dag:EmbeddedDAGNode`, `dag:TerminalNode`.

```ts
<<< @/../examples/the-archivist/viz/render-jsonld.ts#jsonld-render
```

### `DAGONIZER_VOCAB`

```ts twoslash
import { DAGONIZER_VOCAB } from '@studnicky/dagonizer/viz';
// ---cut---
// DAGONIZER_VOCAB === 'https://noocodex.dev/ontology/dagonizer/'
const vocab = DAGONIZER_VOCAB; // type: "https://noocodex.dev/ontology/dagonizer/"
export {};
```

Stable JSON-LD vocabulary URI for the Dagonizer DAG vocabulary. Prefixed as `dag:` in rendered documents.

### Types

```ts twoslash
import type { DagJsonLdDocument, JsonLdGraphEntry } from '@studnicky/dagonizer/viz';
// ---cut---
declare const doc: DagJsonLdDocument;
const ctx: Record<string, string> = doc['@context'];
const graph: readonly JsonLdGraphEntry[] = doc['@graph'];

declare const entry: JsonLdGraphEntry;
const id: string = entry['@id'];
const type: string = entry['@type'];
```

---

## CytoscapeGraph

Subclassable factory class for mounting an interactive cytoscape graph in a DOM container. `cytoscape` and `@dagrejs/dagre` are optional peer dependencies; install them to use this class. The cytoscape runtime is resolved internally by a lazy `Cytoscape.create()` dynamic import, so the package never bundles cytoscape and SSR/headless builds never load it until a graph mounts. A subclass that needs a custom `cytoscape.Core` build (extensions registered, a pinned cytoscape version, a renderer-less test harness) overrides the protected `construct(options)` hook instead of injecting a factory.

```ts twoslash
import { CytoscapeGraph } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const container: HTMLElement;
declare const dag: DAG;
const graph = new CytoscapeGraph(container, dag);
const cy = await graph.mount(); // returns cytoscape.Core
```

### Constructor

```ts twoslash
import { CytoscapeGraph } from '@studnicky/dagonizer/viz';
import type { CytoscapeGraphOptions } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const container: HTMLElement;
declare const dag: DAG;
declare const options: CytoscapeGraphOptions;
// new CytoscapeGraph(container, dag, options?)
const graph = new CytoscapeGraph(container, dag, options);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | `HTMLElement` | DOM element to mount the graph into |
| `dag` | `DAG` | The DAG to render |
| `options` | `CytoscapeGraphOptions?` | Optional configuration |

### `CytoscapeGraphOptions`

| Field | Type | Description |
|-------|------|-------------|
| `embeddedDAGs?` | `ReadonlyMap<string, DAG>` | Registry of embedded-DAGs by name, passed to `CytoscapeRenderer` and `CompositeLayout` for recursive expansion. Default: empty `Map`. |
| `layoutOptions?` | `CompositeLayoutOptions` | Layout tuning options forwarded to `CompositeLayout.compute`. Default: `{}` (all tuning delegated to `CompositeLayout`'s own defaults). |

The constructor accepts `Partial<CytoscapeGraphOptions>`; both fields are optional at the call site with the defaults noted above.

### `async mount(): Promise<cytoscape.Core>`

Builds elements via `CytoscapeRenderer.render`, computes layout via `CompositeLayout.compute` (async), mounts the cytoscape instance into the container, and calls `onReady`. Returns the mounted `cytoscape.Core`.

### `cy` getter

```ts twoslash
import { CytoscapeGraph } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const container: HTMLElement;
declare const dag: DAG;
const graph = new CytoscapeGraph(container, dag);
// cy is null before mount, cytoscape.Core after
const cy = graph.cy;
```

Returns the `cytoscape.Core` after a successful `mount()`, or `null` if the graph has not yet been mounted.

### Protected hooks (override in subclasses)

| Hook | Signature | Purpose |
|------|-----------|---------|
| `construct` | `(options: cytoscape.CytoscapeOptions) => Promise<cytoscape.Core>` | Override to supply a custom `cytoscape.Core` (extensions registered, a pinned build, a headless harness). Default delegates to `Cytoscape.create`, which lazily dynamic-imports the optional `cytoscape` peer. This is the extension point that replaces the former injected factory. |
| `buildElements` | `() => ReadonlyArray<cytoscape.ElementDefinition>` | Override to customize element construction. Default delegates to `CytoscapeRenderer.render`. |
| `stylesheet` | `() => cytoscape.StylesheetStyle[]` | Override to supply a custom stylesheet. |
| `presetLayout` | `() => cytoscape.PresetLayoutOptions` | Override to change the preset layout options passed to cytoscape. Default uses `preset` with `fit: true, padding: 60`. |
| `interactionDefaults` | `() => Record<string, unknown>` | Override to customize pan/zoom/interaction defaults spread into the cytoscape constructor. |
| `layoutRegistry` | `() => ReadonlyMap<string, DAG>` | Override to return the embedded-DAG subset used for layout. Default returns the full `embeddedDAGs` passed at construction. |
| `applyLayout` | `(elements: ReadonlyArray<cytoscape.ElementDefinition>) => Promise<cytoscape.ElementDefinition[]>` | Override to customize the layout application step. Default calls `CompositeLayout.compute` and attaches positions to each node element. |
| `enforceVisibility` | `(cy: cytoscape.Core) => void` | Override to replace the self-loop size-cache flush strategy. Default toggles `display` off then on in two `cy.batch()` calls. |
| `onReady` | `(cy: cytoscape.Core) => void` | Called after mount and visibility sweep complete. Override to wire animation machines or event listeners. Default is a no-op. |

### Example: subclassing for doc animations

The Archivist example's `ArchivistGraph` extends `CytoscapeGraph` and overrides `onReady` to attach execution-trace animation:

```ts
<<< @/../examples/the-archivist/viz/ArchivistGraph.ts#cytoscape-graph-subclass
```

---

## CytoscapeRenderer

Static class. Returns a plain element array with NO computed positions. Layout is performed separately by `CompositeLayout.compute` or handled internally by `CytoscapeGraph`.

```ts twoslash
import { CytoscapeRenderer } from '@studnicky/dagonizer/viz';
import type { CytoscapeElement, RenderOptions } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const dag: DAG;
const elements: readonly CytoscapeElement[] = CytoscapeRenderer.render(dag);
```

Renders a `DAG` as a Cytoscape elements array.

- Every placement becomes a node element with a `type` field (`'single'` | `'scatter'` | `'embedded-dag'` | `'terminal'` | `'phase'`) for per-type stylesheet selectors.
- Every output route becomes a labeled edge element.
- Embedded-DAG placements are expanded inline when their target DAG is supplied via `options.embeddedDAGs`, showing the full inner flow as a compound cluster.
- Routes to `null` become edges to a synthetic `END` terminal node.

```ts
<<< @/../examples/the-archivist/viz/render-cytoscape.ts#cytoscape-render
```

### `RenderOptions`

```ts twoslash
import type { RenderOptions } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const opts: RenderOptions;
// embeddedDAGs?: ReadonlyMap<string, DAG>
// maxDepth?: number  (default 6)
export {};
```

Note: `computeLayout` and `layoutOptions` are not options on `CytoscapeRenderer.render`. Positioning is performed by `CompositeLayout.compute` (async) or handled internally by `CytoscapeGraph`.

### Containment metadata

Placements bound to a `container` role (worker/isolate) carry:
- `data.container` — the role string (e.g. `'cpu'`), present only when a role is set
- CSS class `dag-contained` — appended alongside the type class (e.g. `'dag-scatter dag-contained'`)

In-process placements omit `data.container` entirely and carry only the type class.

Select contained nodes via `.dag-contained` (class selector) or `node[container]` / `node[container="<role>"]` (data selectors).

### Types

```ts twoslash
import type {
  CytoscapeElement,
  CytoscapeNodeElement,
  CytoscapeEdgeElement,
} from '@studnicky/dagonizer/viz';
// ---cut---
declare const el: CytoscapeElement;

// CytoscapeNodeElement
declare const node: CytoscapeNodeElement;
const _group: 'nodes' = node.group;
const _id: string = node.data.id;
const _label: string = node.data.label;
const _type: 'single' | 'scatter' | 'embedded-dag' | 'terminal' | 'phase' = node.data.type;
const _classes: string = node.classes;

// CytoscapeEdgeElement
declare const edge: CytoscapeEdgeElement;
const _eg: 'edges' = edge.group;
const _eid: string = edge.data.id;
const _src: string = edge.data.source;
const _tgt: string = edge.data.target;
const _lbl: string = edge.data.label;
const _route: string = edge.data.route;
const _eclasses: string = edge.classes;
```

## CompositeLayout

Static class that computes node positions for a `DAG` using `@dagrejs/dagre`. `compute` is async: it lazy-loads dagre, recursively lays out embedded-DAG sub-graphs bottom-up, and returns a `LayoutResult` with a position map and bounding-box dimensions.

```ts twoslash
import { CompositeLayout } from '@studnicky/dagonizer/viz';
import type { LayoutResult } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const dag: DAG;
const embeddedDAGs: ReadonlyMap<string, DAG> = new Map();
const result: LayoutResult = await CompositeLayout.compute(dag, embeddedDAGs);
// result.positions: ReadonlyMap<string, { x: number; y: number }>
// result.width:     number  (total bounding-box width)
// result.height:    number  (total bounding-box height)
```

`CytoscapeGraph.mount()` calls `CompositeLayout.compute` internally via `applyLayout`; direct use is for consumers managing their own cytoscape instances outside the factory.

```ts twoslash
import { CompositeLayout } from '@studnicky/dagonizer/viz';
import type { LayoutResult, CompositeLayoutOptions } from '@studnicky/dagonizer/viz';
import type { DAG } from '@studnicky/dagonizer';
// ---cut---
declare const dag: DAG;
declare const embeddedDAGs: ReadonlyMap<string, DAG>;
declare const options: CompositeLayoutOptions;
const result: LayoutResult = await CompositeLayout.compute(dag, embeddedDAGs, options);
```

`LayoutResult`:

```ts twoslash
import type { LayoutResult, NodePosition } from '@studnicky/dagonizer/viz';
// ---cut---
declare const result: LayoutResult;
const positions: ReadonlyMap<string, NodePosition> = result.positions;
const width: number = result.width;
const height: number = result.height;

declare const pos: NodePosition;
const x: number = pos.x;
const y: number = pos.y;
```

---

## Related guides

- [Visualization](../guide/visualization)
- [Contract-derived flows](../guide/derive)
- [DAGBuilder](../guide/builder)
