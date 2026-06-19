---
title: 'JSON-LD export and import'
description: 'Serialize Dagonizer DAGs as JSON-LD 1.1 documents and round-trip them via DAGDocument.serialize and DAGDocument.load. Every DAG carries @context, @id, and @type so RDF stores, schema validators, and JSON-LD processors read the wire shape natively.'
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

Dagonizer DAGs are JSON-LD 1.1 documents. There is no separate wire format or projection layer. The object `DAGBuilder.build()` returns is the same object the engine consumes and the same object that round-trips through `DAGDocument.serialize` and `DAGDocument.load`. Every DAG carries `@context`, `@id`, and `@type` so RDF stores, schema validators, and generic JSON-LD processors read the shape natively without an adapter.

## The canonical shape

A DAG document carries these top-level fields:

- `@context`. The canonical Dagonizer JSON-LD context inlined as an object literal. The full context is exported from `@studnicky/dagonizer` as `DAG_CONTEXT` (source: `packages/dagonizer/src/entities/dag/DAG.ts`). `DAGBuilder.build()` embeds it verbatim.
- `@id`. URN identifier for the DAG document. Convention: `urn:noocodex:dag:<name>`.
- `@type`. RDF class. `"DAG"` for the document; one of `"SingleNode"`, `"ScatterNode"`, `"EmbeddedDAGNode"`, `"TerminalNode"`, or `"PhaseNode"` for placements.
- `name`, `version`, `entrypoint`. The dispatcher uses `name` and `entrypoint` to register and execute.
- `nodes`. Array of placement objects, each with its own `@id` and `@type`.

The Phase 03 demo embeds a full JSON-LD DAG as a string and feeds it through the ingest boundary:

<<< @/../examples/dags/03-schema.ts#dag-literal

Placement `@id`s typically nest under the DAG's URN: `urn:noocodex:dag:demo/node/transform`.

## `@type` vocabulary

Six placement classes plus the document class:

| `@type` | Role |
|---|---|
| `DAG` | Top-level document |
| `SingleNode` | One registered node, routed by named outputs |
| `ScatterNode` | Fork over a `source` array: one clone per item, run a body in each clone, gather produced state back through a required `gather`, route on aggregate outcome |
| `EmbeddedDAGNode` | Invoke a nested registered DAG at cardinality 1, with optional `stateMapping` to copy fields in and out |
| `TerminalNode` | Explicit terminus with `outcome` of `'completed'` or `'failed'` |
| `PhaseNode` | Lifecycle-attached pre or post placement |

## Exporting

`DAGDocument.serialize(dag)` produces pretty-printed JSON (2-space indent):

<<< @/../examples/json-ld.ts#persistence-file

`DAGDocument.serializeCompact(dag)` produces single-line JSON (no whitespace) for transport over the wire:

<<< @/../examples/json-ld.ts#serialize-compact

The serializer is a thin wrapper over `JSON.stringify`. There is no transformation step. The object IS the wire shape.

## Importing

`DAGDocument.load(json)` parses and validates a JSON-LD string. It is the single ingest boundary for external input. `unknown` enters here and exits as a fully-typed `DAG`:

<<< @/../examples/dags/03-schema.ts#load

`DAGDocument.load` throws `ValidationError` for:

- Malformed JSON (delegates to `JSON.parse`).
- Schema-noncompliant input (validates against `DAGSchema` via Ajv 2020-12).
- Missing required fields (`@context`, `@id`, `@type`, `name`, `version`, `entrypoint`, `nodes`).
- Invalid `@type` discriminator on any placement.

For callers that have already decoded their input (a database row that returned a parsed object, for example), `DAGDocument.ofValue(value)` skips the JSON parse step and runs only the schema validation.

## Round-trip

<<< @/../examples/json-ld.ts#round-trip

The round-trip preserves identity. `DAGDocument.load(DAGDocument.serialize(dag))` produces a value structurally equal to `dag`.

## Placement discriminators

Each placement type carries a distinct `@type` that drives the runtime dispatch:

| `@type` | Placement | Required fields |
|---|---|---|
| `SingleNode` | One registered node | `@id`, `@type`, `name`, `node`, `outputs` |
| `ScatterNode` | Fork over source array, run body per clone, gather, route | `@id`, `@type`, `name`, `body`, `source`, `gather`, `outputs` |
| `EmbeddedDAGNode` | Nested DAG invocation at cardinality 1 | `@id`, `@type`, `name`, `dag`, `outputs` |
| `TerminalNode` | Explicit terminus | `@id`, `@type`, `name`, `outcome` |
| `PhaseNode` | Lifecycle-attached node | `@id`, `@type`, `name`, `phase`, `node` |

## Persistence patterns

The serializer and loader have no opinion about storage. File on disk:

<<< @/../examples/json-ld.ts#persistence-file

Database column (text or JSON body):

<<< @/../examples/json-ld.ts#persistence-db

For HTTP transport, use `serializeCompact` and the `application/ld+json` content-type. For already-parsed values (Postgres `jsonb`, decoded message envelope), use `DAGDocument.ofValue`:

<<< @/../examples/json-ld.ts#from-value-round-trip

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
