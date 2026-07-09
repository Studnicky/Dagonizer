---
title: 'Example 03: Tool Schemas'
description: 'Tool schema design in The Archivist: JSON Schema 2020-12 input schemas on SubjectSearchTool and CanonicalId cross-source deduplication. Shape-only examples prevent LLM verbatim echo.'
seeAlso:
  - text: 'Running domain: The Archivist'
    link: './the-archivist'
  - text: 'Schema and JSON loading guide'
    link: '../guide/schema'
  - text: 'Example 02: DAGBuilder'
    link: './02-builder'
    description: 'the DAG topology the tools feed into'
  - text: 'Reference: Validation, `Validator.dag`'
    link: '../reference/validation'
  - text: 'Reference: Errors, `ValidationError`'
    link: '../reference/errors'
---

<script setup lang="ts">
import { BookSearchScatterDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Example 03: Tool Schemas

## What It Is

Example 03 is about the contract between a model-facing tool definition and the DAG that actually executes work. The Archivist lets a model choose book-search tools, but JSON Schema describes the allowed input shape and Dagonizer still owns validation, routing, retries, and merge behavior.

The page also covers a small but painful detail: schema examples can leak into model output. The tool definitions use shape-only placeholders so a model learns the structure without copying fake titles or identifiers into a visitor-facing answer.

## How It Works

The model sees tool names, descriptions, and JSON Schema input shapes. It can propose `{ name, arguments }` calls, but it does not get arbitrary access to application code. The DAG receives the selected calls, validates their arguments, builds concrete worksets, and sends those worksets through registered nodes and sub-DAGs.

The schemas describe input contracts only. The dispatcher still controls which node runs, how outputs merge, and which terminal route the flow takes. This keeps the model in the planning lane and keeps execution inside the graph.

## Diagrams, Examples, and Outputs

The diagram is the `book-search-scatter` DAG from the Archivist. Tool planning happens before this sub-DAG; this graph shows what the application does after it turns a model plan into concrete search work.

### DAG registration and diagram

[The Archivist](./the-archivist) exposes its book-search capabilities to the LLM as typed tools with JSON Schema 2020-12 `inputSchema` definitions. `decideTools` creates a `toolPlan`; the `book-search-scatter` DAG turns that plan into concrete scout work.

<DagJsonMermaid :dag="BookSearchScatterDAG" title="book-search-scatter" aria-label="The book-search-scatter JSON-LD DAG beside Mermaid generated from it." />

### Run

```bash
npm run docs:dev
```

## What It Lets You Do

Tool schemas let applications expose useful model-callable capabilities without giving the model arbitrary application access. The model can choose a tool and fill an argument object; the DAG still decides validation, fan-out, retry, dedupe, ranking, and response composition.

## Code Samples

These snippets are the runnable model/tool boundary inside The Archivist. The model sees schema-backed tool definitions through `decideTools`; the example code then converts the selected calls into DAG worksets and deduplicates the returned candidates after execution.

### Code

#### DecideToolsNode: schema-backed tool planning

`DecideToolsNode` passes registered tool definitions to the LLM adapter, applies deterministic safety nets for common query shapes, and writes the selected calls to `state.toolPlan`:

<<< @/../examples/the-archivist/nodes/decideTools.ts

#### BuildBookWorksetsNode: tool calls become DAG references

The workset builder turns `state.toolPlan` into JSON-serializable items. Each item carries `dagIri: 'urn:noocodec:tool:<name>'`, which the scatter placement resolves through a dynamic `DagReference`:

<<< @/../examples/the-archivist/nodes/buildBookWorksets.ts

#### MergeCandidatesNode: cross-source deduplication

Every tool produces candidates that merge through `CanonicalId.dedupe` in the runnable node. The same work indexed by OpenLibrary, Google Books, or Wikipedia folds into one shortlist entry before response composition:

<<< @/../examples/the-archivist/nodes/mergeCandidates.ts

## Details for Nerds

The tool boundary is a schema boundary, not a trust boundary by itself. You still validate arguments before execution, normalize identifiers across providers, and merge duplicate candidates by canonical ID. The schema narrows what the model can ask for; the DAG decides what actually happens.

### What it demonstrates
- **`additionalProperties: true`.** The schema lets the LLM pass extra OpenLibrary parameters (`lang`, `first_publish_year`) without a schema change. Strict mode on input validation would reject them; `additionalProperties: true` allows pass-through.
- **Shape-only `examples`.** `'<subject-or-theme>'`, `'<plot-motif>'` are descriptive placeholders. Never use real data in `examples` fields when the LLM will see the schema; it may copy them back verbatim into responses.
- **`strict: true`.** Signals to the Gemini API that the tool definition should be treated as a strict JSON schema. The field is passed through to the model's function declaration.
- **`CanonicalId.pick`.** Resolves ISBN-13, ISBN-10, then `urn:work:<slug>` in priority order. All four scouts call it so `CanonicalId.dedupe` in `mergeCandidates` can collapse cross-source duplicates by the same stable key.
- **`CanonicalId.merge`.** When two candidates share the same canonical id, `merge` unions their authors, subjects, publishers, and `sources[]` arrays, keeping the richer description and higher score.

See this in action in the [Archivist live demo](./the-archivist).

## Related Concepts

Read these next when you want to connect model-facing schemas to DAG validation and runtime errors.

- [Running domain: The Archivist](./the-archivist)
- [Schema and JSON loading guide](../guide/schema)
- [Example 02: DAGBuilder](./02-builder) - the DAG topology the tools feed into
- [Reference: Validation, `Validator.dag`](../reference/validation)
- [Reference: Errors, `ValidationError`](../reference/errors)
