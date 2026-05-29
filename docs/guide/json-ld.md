---
title: 'JSON-LD export and import'
description: 'Serialize Dagonizer DAGs as JSON-LD 1.1 documents and round-trip them via Dagonizer.serialize and Dagonizer.load. Every DAG carries @context, @id, and @type so RDF stores, schema validators, and JSON-LD processors read the wire shape natively.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'fluent authoring API; build() returns canonical JSON-LD'
  - text: 'Schema and JSON loading'
    link: './schema'
    description: 'Ajv validation surface at the ingest boundary'
  - text: 'Architecture'
    link: '../architecture'
    description: 'JSON-LD canonical wire format in the framework architecture'
  - text: 'Entities'
    link: '../reference/entities'
    description: 'every @type and its required field set'
nextSteps:
  - text: 'Phase 03, Schema loading demo'
    link: '../examples/03-schema'
    description: 'runnable load-and-round-trip example'
  - text: 'Checkpoint and resume'
    link: './checkpoint'
    description: 'serialize in-flight DAG state alongside the topology'
  - text: 'Visualization'
    link: './visualization'
    description: 'render a JSON-LD DAG to Mermaid or Cytoscape'
---

# JSON-LD export and import

Dagonizer DAGs are JSON-LD 1.1 documents. There is no separate wire format or projection layer. The object `DAGBuilder.build()` returns is the same object the engine consumes and the same object that round-trips through `Dagonizer.serialize` and `Dagonizer.load`. Every DAG carries `@context`, `@id`, and `@type` so RDF stores, schema validators, and generic JSON-LD processors read the shape natively without an adapter.

## The canonical shape

A DAG document carries these top-level fields:

- `@context`. The canonical Dagonizer JSON-LD context inlined as an object literal. The full context is exported from `@noocodex/dagonizer` as `DAG_CONTEXT` (source: `packages/dagonizer/src/entities/dag/DAG.ts`). `DAGBuilder.build()` embeds it verbatim.
- `@id`. URN identifier for the DAG document. Convention: `urn:noocodex:dag:<name>`.
- `@type`. RDF class. `"DAG"` for the document; one of `"SingleNode"`, `"ParallelNode"`, `"ScatterNode"`, `"TerminalNode"`, or `"PhaseNode"` for placements.
- `name`, `version`, `entrypoint`. The dispatcher uses `name` and `entrypoint` to register and execute.
- `nodes`. Array of placement objects, each with its own `@id` and `@type`.

The Phase 03 demo embeds a full JSON-LD DAG as a string and feeds it through the ingest boundary:

<<< @/../examples/03-schema.ts#dag-literal

Placement `@id`s typically nest under the DAG's URN: `urn:noocodex:dag:demo/node/transform`.

## `@type` vocabulary

Five placement classes plus the document class:

| `@type` | Role |
|---|---|
| `DAG` | Top-level document |
| `SingleNode` | One registered node, routed by named outputs |
| `ParallelNode` | Concurrent nodes with a combine strategy |
| `ScatterNode` | Isolate a clone, run a `body` (node or sub-DAG), gather produced state, route on aggregate outcome |
| `TerminalNode` | Explicit terminus with `outcome` of `'completed'` or `'failed'` |
| `PhaseNode` | Lifecycle-attached pre or post placement |

## Exporting

`Dagonizer.serialize(dag)` produces pretty-printed JSON (2-space indent):

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const json = Dagonizer.serialize(dag);
await fs.writeFile('dag.json', json);
```

`Dagonizer.serializeCompact(dag)` produces single-line JSON (no whitespace) for transport over the wire:

```ts
const compact = Dagonizer.serializeCompact(dag);
// → '{"@context":...,"@id":"...","@type":"DAG",...}'
```

The serializer is a thin wrapper over `JSON.stringify`. There is no transformation step. The object IS the wire shape.

## Importing

`Dagonizer.load(json)` parses and validates a JSON-LD string. It is the single ingest boundary for external input. `unknown` enters here and exits as a fully-typed `DAG`:

<<< @/../examples/03-schema.ts#load

`Dagonizer.load` throws `ValidationError` for:

- Malformed JSON (delegates to `JSON.parse`).
- Schema-noncompliant input (validates against `DAGSchema` via Ajv 2020-12).
- Missing required fields (`@context`, `@id`, `@type`, `name`, `version`, `entrypoint`, `nodes`).
- Invalid `@type` discriminator on any placement.

For callers that have already decoded their input (a database row that returned a parsed object, for example), `Dagonizer.fromValue(value)` skips the JSON parse step and runs only the schema validation.

## Round-trip

```ts
import { Dagonizer, DAGBuilder } from '@noocodex/dagonizer';

// Author the DAG via the builder
const original = new DAGBuilder('demo', '1')
  .node('transform', transformNode, { success: null })
  .build();

// Serialize → JSON string
const json = Dagonizer.serialize(original);

// Load → DAG (validated)
const reloaded = Dagonizer.load(json);

// Identical structure, fully typed
console.log(reloaded['@type']);            // 'DAG'
console.log(reloaded.nodes[0]['@type']);   // 'SingleNode'
```

The round-trip preserves identity. `Dagonizer.load(Dagonizer.serialize(dag))` produces a value structurally equal to `dag`.

## Placement discriminators

Each placement type carries a distinct `@type` that drives the runtime dispatch:

| `@type` | Placement | Required fields |
|---|---|---|
| `SingleNode` | One registered node | `@id`, `@type`, `name`, `node`, `outputs` |
| `ParallelNode` | Concurrent nodes with combine strategy | `@id`, `@type`, `name`, `nodes`, `combine`, `outputs` |
| `ScatterNode` | Clone, run body, gather, route | `@id`, `@type`, `name`, `body`, `outputs` |
| `TerminalNode` | Explicit terminus | `@id`, `@type`, `name`, `outcome` |
| `PhaseNode` | Lifecycle-attached node | `@id`, `@type`, `name`, `phase`, `node` |

`ParallelNode` carries a nested type-scoped `@context` that remaps the `nodes` key (within `ParallelNode` objects, `nodes` is an array of child name strings; at the DAG root, `nodes` is an array of placement objects). The remapping is invisible to consumers reading via `Dagonizer.load`, but RDF and JSON-LD processors see the distinction natively.

## Persistence patterns

The serializer and loader have no opinion about storage. Common patterns:

```ts
// File on disk
await fs.writeFile('dag.json', Dagonizer.serialize(dag));
const loaded = Dagonizer.load(await fs.readFile('dag.json', 'utf8'));

// Database column (text or JSON)
await db.dags.insert({ id: dag['@id'], body: Dagonizer.serialize(dag) });
const row = await db.dags.findById('urn:noocodex:dag:demo');
const loaded = Dagonizer.load(row.body);

// HTTP API
return new Response(Dagonizer.serializeCompact(dag), {
  headers: { 'content-type': 'application/ld+json' },
});

// Already-parsed JSON (a Postgres jsonb column, for example)
const dag = Dagonizer.fromValue(row.body);  // body is `unknown`
```

The MIME type `application/ld+json` is the canonical content-type for JSON-LD over HTTP. Dagonizer DAGs satisfy that contract.

## RDF interop

Because every field carries a canonical IRI through `@context`, a Dagonizer DAG is a valid RDF graph. Generic JSON-LD processors can extract triples without knowing anything about Dagonizer:

```
<urn:noocodex:dag:demo>
  rdf:type                              dag:DAG ;
  dag:name                              "demo" ;
  dag:version                           "1" ;
  dag:entrypoint                        "transform" ;
  dag:nodes                             <urn:noocodex:dag:demo/node/transform> .

<urn:noocodex:dag:demo/node/transform>
  rdf:type                              dag:SingleNode ;
  dag:name                              "transform" ;
  dag:node                              "transform" ;
  dag:outputs                           [ dag:success "null" ] .
```

This is the same data the engine consumes. No separate ontology model, no projection. Consumers that want to query DAGs as RDF (SHACL validation, SPARQL queries over a fleet of stored DAGs) get it for free by treating the JSON document as JSON-LD.

## Related reference

- [Phase 03, Schema loading demo](../examples/03-schema)
- [Reference, Entities](../reference/entities)
- [Reference, Validation](../reference/validation)
