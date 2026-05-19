---
title: 'JSON-LD export and import'
description: 'Serialize Dagonizer DAGs as JSON-LD 1.1 documents and round-trip them back via Dagonizer.serialize and Dagonizer.load. Every DAG carries `@context`, `@id`, and `@type` so downstream tooling (RDF stores, schema validators, JSON-LD processors) reads the wire shape natively.'
seeAlso:
  - text: 'DAGBuilder'
    link: './builder'
    description: 'fluent authoring API; the output of build() is already canonical JSON-LD'
  - text: 'Schema & JSON loading'
    link: './schema'
    description: 'Ajv validation surface at the ingest boundary'
  - text: 'Architecture'
    link: '../architecture'
    description: 'JSON-LD canonical wire format in the framework architecture'
  - text: 'DAG entities'
    link: '../reference/entities'
    description: 'every `@type` and its required field set'
nextSteps:
  - text: 'Checkpoint'
    link: './checkpoint'
    description: 'serialize in-flight DAG state alongside the topology'
  - text: 'Visualization'
    link: './visualization'
    description: 'render a JSON-LD DAG to Mermaid or Cytoscape'
---

# JSON-LD export and import

Dagonizer DAGs are JSON-LD 1.1 documents. There is no separate "wire format" or projection layer — the object `DAGBuilder.build()` returns is the same object the engine consumes and the same object that round-trips through `Dagonizer.serialize` / `Dagonizer.load`. Every DAG carries `@context`, `@id`, and `@type` so downstream tooling (RDF stores, schema validators, generic JSON-LD processors) reads the shape natively without an adapter.

## ⦿ The canonical shape

A minimal DAG document:

```json
{
  "@context": "https://noocodex.dev/ontology/dagonizer/v1/context",
  "@id": "urn:noocodex:dag:demo",
  "@type": "DAG",
  "name": "demo",
  "version": "1",
  "entrypoint": "transform",
  "nodes": [
    {
      "@id": "urn:noocodex:dag:demo/node/transform",
      "@type": "SingleNode",
      "name": "transform",
      "node": "transform",
      "outputs": { "success": null }
    }
  ]
}
```

⦿ `@context` — the canonical Dagonizer JSON-LD context (`DAG_CONTEXT` in `@noocodex/dagonizer`). Identifies the ontology namespace.
⦿ `@id` — URN identifier for this DAG document. Convention: `urn:noocodex:dag:<name>`.
⦿ `@type` — RDF class. `"DAG"` for the document; `"SingleNode"` / `"ParallelNode"` / `"FanOutNode"` / `"DeepDAGNode"` for placements.

Every placement has its own `@id` and `@type`. Placement `@id`s typically nest under the DAG's URN: `urn:noocodex:dag:demo/node/transform`.

## ⦿ Exporting

`Dagonizer.serialize(dag)` produces pretty-printed JSON (2-space indent):

```ts
import { Dagonizer } from '@noocodex/dagonizer';

const json = Dagonizer.serialize(dag);
// → multi-line JSON string ready to write to a file or KV store
await fs.writeFile('dag.json', json);
```

`Dagonizer.serializeCompact(dag)` produces single-line JSON (no whitespace) for transport over the wire:

```ts
const compact = Dagonizer.serializeCompact(dag);
// → '{"@context":"...","@id":"...","@type":"DAG",...}'
```

The serializer is a thin wrapper over `JSON.stringify` — there is no transformation step. The object IS the wire shape.

## ⦿ Importing

`Dagonizer.load(json)` parses and validates a JSON-LD string. It is the single ingest boundary for external input — `unknown` enters here and exits as a fully-typed `DAG`:

```ts
import { Dagonizer } from '@noocodex/dagonizer';
import type { DAG } from '@noocodex/dagonizer';

const json: string = await fs.readFile('dag.json', 'utf8');
const dag: DAG = Dagonizer.load(json);

dispatcher.registerDAG(dag);
const result = await dispatcher.execute(dag.name, new MyState());
```

`Dagonizer.load` throws `ValidationError` for:

⦿ Malformed JSON (delegates to `JSON.parse`)
⦿ Schema-noncompliant input (validates against `DAGSchema` via Ajv 2020-12)
⦿ Missing required fields (`@context`, `@id`, `@type`, `name`, `version`, `entrypoint`, `nodes`)
⦿ Invalid `@type` discriminator on any placement
⦿ Unwired output references (compile-time check unavailable at the JSON boundary; the validator catches them at runtime)

For callers that have already decoded their input (e.g. via a database row that returned a parsed object), `Dagonizer.fromValue(value)` skips the JSON parse step and runs only the schema validation.

## ⦿ Round-trip

```ts
import { Dagonizer, DAGBuilder } from '@noocodex/dagonizer';

// Author the DAG via the builder
const original = new DAGBuilder('demo')
  .node('transform', { success: null })
  .build();

// Serialize → JSON string
const json = Dagonizer.serialize(original);

// Load → DAG (validated)
const reloaded = Dagonizer.load(json);

// Identical structure, fully typed
console.log(reloaded['@type']);                  // 'DAG'
console.log(reloaded.nodes[0]['@type']);         // 'SingleNode'
```

The round-trip preserves identity — `Dagonizer.load(Dagonizer.serialize(dag))` produces a value structurally equal to `dag`.

## ⦿ Placement discriminators

Each placement type carries a distinct `@type` that drives the runtime dispatch:

| `@type` | Placement | Required fields |
|---------|-----------|-----------------|
| `SingleNode` | one registered node | `@id`, `@type`, `name`, `node`, `outputs` |
| `ParallelNode` | concurrent nodes with combine strategy | `@id`, `@type`, `name`, `nodes`, `combine`, `outputs` |
| `FanOutNode` | one node per array item | `@id`, `@type`, `name`, `node`, `source`, `fanIn`, `outputs` |
| `DeepDAGNode` | nested DAG invocation | `@id`, `@type`, `name`, `dag`, `outputs` |

`ParallelNode` carries a nested type-scoped `@context` that remaps the `nodes` key (within ParallelNode objects, `nodes` is an array of child name strings; at the DAG root, `nodes` is an array of placement objects). The remapping is invisible to consumers reading via `Dagonizer.load`, but RDF/JSON-LD processors see the distinction natively.

## ⦿ Persistence patterns

The serializer/loader pair has no opinion about storage. Common patterns:

```ts
// File on disk
await fs.writeFile('dag.json', Dagonizer.serialize(dag));
const loaded = Dagonizer.load(await fs.readFile('dag.json', 'utf8'));

// Database column (text/JSON)
await db.dags.insert({ id: dag['@id'], body: Dagonizer.serialize(dag) });
const row = await db.dags.findById('urn:noocodex:dag:demo');
const loaded = Dagonizer.load(row.body);

// HTTP API
return new Response(Dagonizer.serializeCompact(dag), {
  headers: { 'content-type': 'application/ld+json' },
});

// Already-parsed JSON (e.g. from a Postgres jsonb column)
const dag = Dagonizer.fromValue(row.body);  // body is `unknown`
```

The MIME type `application/ld+json` is the canonical content-type for JSON-LD over HTTP — Dagonizer DAGs satisfy that contract.

## ⦿ RDF interop

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

This is the same data the engine consumes — no separate ontology model, no projection. Consumers that want to query DAGs as RDF (SHACL validation, SPARQL queries over a fleet of stored DAGs) get it for free by treating the JSON document as JSON-LD.
