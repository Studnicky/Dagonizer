---
title: 'RDF 1.2'
description: 'RDF 1.2 triple-term and annotation guidance for Dagonizer DAG composition.'
seeAlso:
  - text: 'Reference: Visualization'
    link: './viz'
    description: 'JSON-LD renderer and graph export'
  - text: 'Reference: Store'
    link: './store'
    description: 'RDF-capable store and snapshot boundaries'
---

# RDF 1.2

## What It Is

RDF 1.2 adds triple terms, reifying triples, triple annotations, directional language strings, and version announcements to the RDF model and concrete syntaxes. For Dagonizer, the relevant feature is the ability to describe a DAG edge, placement, provenance claim, or composition relation as a first-class statement without expanding to RDF 1.1 statement reification quads.

The repo semantic stack uses `n3@2.1.1`. The package parses, stores, and serializes RDF 1.2 triple terms at runtime. The published `@types/n3@1.26.1` declarations do not expose every RDF 1.2 shape directly, so typed code should model triple terms through RDF/JS interfaces from `@rdfjs/types` when a probe needs quad-as-term safety.

## Standards Status

RDF 1.2 Concepts is a W3C Candidate Recommendation Snapshot. It defines a triple term as an RDF triple used as an RDF term inside another triple, and defines `rdf:reifies` as the predicate that connects a reifier to a triple term.

RDF 1.2 Turtle is a W3C Working Draft. It defines the `<<( ... )>>` triple-term syntax and annotation syntax. An annotation expands to an asserted triple plus a reifier that points at the asserted triple term with `rdf:reifies`.

JSON-LD 1.1 is the deployed Recommendation. The JSON-LD-star Community Group note defines `@annotation` and embedded-node forms for RDF-star/RDF 1.2-style statements about statements. The 2026 JSON-LD Working Group charter keeps RDF 1.2 compatibility in scope for future Recommendation-track JSON-LD work, but parser implementations already exist. Dagonizer uses those parser-backed JSON-LD-star forms for RDF 1.2 semantic enrichment now while `DAGDocument.load()` remains the JSON-LD 1.1-compatible DAG schema boundary.

## Local Stack Findings

`n3@2.1.1` constructs RDF 1.2 triple terms with `DataFactory.quad(...)` and serializes reifying triples as `<<(...)>>`. The store can match an `rdf:reifies` object whose term type is `Quad`.

`Parser` also accepts RDF 1.2 `VERSION "1.2"`, explicit triple-term syntax, and Turtle annotation syntax at runtime. The installed `@types/n3` parser generic cannot represent that safely because its `BaseQuad` constraint is tied to N3 class declarations that do not expose RDF/JS triple terms as parser output.

The N3 focused probe lives at `examples/the-archivist/tests/unit/rdf12-triple-term-probe.test.ts`. It avoids casts and suppression comments by assigning `N3.DataFactory` to the RDF/JS `DataFactory` interface, constructing a reifying triple through RDF/JS `Quad` and `Quad_Object`, and using `Store.readQuads(...)` instead of `Store.getQuads(...)` so the returned quads keep RDF/JS types.

`jsonld-streaming-parser@5.0.1` parses JSON-LD-star embedded-node input with `rdfstar` enabled. The RDF 1.2-aligned form is a reifier node with an `rdf:reifies` value whose `@id` is an embedded triple; parser output is an `rdf:reifies` quad whose object has `termType: 'Quad'`. The parser also accepts the older JSON-LD-star `@annotation` shorthand and emits annotation facts whose subjects have `termType: 'Quad'`.

`jsonld-streaming-serializer@4.0.0` can emit JSON-LD-star from RDF/JS quads. The current round-trip probe uses full-IRI serializer output because context-compacted serializer output does not preserve triple-term subjects when reparsed by the same parser.

The JSON-LD-star focused probe lives at `examples/the-archivist/tests/unit/rdf12-jsonld-star-probe.test.ts`. The runtime helper lives at `examples/the-archivist/memory/Rdf12JsonLd.ts` and exposes `parse(...)` and `serialize(...)` for RDF/JS quads.

`@rdfjs/types` is present through the installed `@types/n3` dependency tree. If RDF 1.2 triple terms move from probe code into exported package APIs, the owning package should declare `@rdfjs/types` directly before exposing those types.

## Architecture Recommendation

Use RDF 1.2 triple annotations for statement-level metadata: edge confidence, route provenance, mapping source, policy decision, composition rationale, and execution observation. Keep named graphs as the main boundary for snapshots, runs, sources, and sub-DAG documents.

Model DAG composition in two layers:

- Graph identity: one named graph per DAG document, embedded DAG, run snapshot, or imported source. This keeps MemoryStore snapshots, provenance isolation, and JSON-LD export compatible with the current stack.
- Statement identity: one RDF 1.2 reifier per annotated edge or placement claim. The reifier carries metadata such as `prov:wasGeneratedBy`, score, timestamp, or source. The reifier points at the route or composition triple via `rdf:reifies`.

Do not wait for JSON-LD Recommendation-track alignment before using RDF 1.2 annotations in graph composition work. Use JSON-LD-star at semantic import/export boundaries through `Rdf12JsonLd.parse(...)` and RDF/JS quads. Prefer RDF 1.2 reifier nodes with `rdf:reifies` for new graph composition data; accept `@annotation` shorthand when interoperating with existing JSON-LD-star producers. Keep `DAGDocument.load()` focused on the canonical DAG schema until the DAG entity model itself adopts statement-level metadata.

For persisted DAG topology, keep the current JSON-LD DAG document shape as the schema-validated assembly format. For semantic memory, provenance, graph composition, and DAG analysis, allow RDF 1.2 triple terms inside explicit RDF/JS boundaries and test every boundary that serializes, stores, or reparses those quads.

## Sources

- W3C RDF 1.2 Concepts and Abstract Data Model: https://www.w3.org/TR/rdf12-concepts/
- W3C RDF 1.2 Turtle: https://www.w3.org/TR/rdf12-turtle/
- W3C JSON-LD 1.1: https://www.w3.org/TR/json-ld11/
- W3C JSON-LD Working Group Charter: https://www.w3.org/2026/01/json-ld-wg-charter.html
- JSON-LD-star Community Group Note: https://json-ld.github.io/json-ld-star/
- JSON-LD-star Processor Conformance: https://json-ld.github.io/json-ld-star/reports/
- JSON-LD Streaming Parser: https://github.com/rubensworks/jsonld-streaming-parser.js/
- JSON-LD Streaming Serializer: https://github.com/rubensworks/jsonld-streaming-serializer.js/
- N3.js releases: https://github.com/rdfjs/N3.js/releases
