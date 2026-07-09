# GitHub Pages Content Audit

## Scope

This audit covers the public GitHub Pages Markdown set under `docs/`.
`docs/index.md` and `docs/concepts.md` are intentionally excluded because the
home page and concepts hub use their own hero/navigation structure.

Every other public page follows the same consumer-grade contract:

1. **What It Is** - the architecture principle, page role, and consumer problem.
2. **How It Works** - one or two explanatory paragraphs about runtime mechanics.
3. **Diagrams, Examples, and Outputs** - where the JSON-LD, Mermaid graph,
   runnable demo, rendered output, or execution trace proves the concept.
4. **What It Lets You Do** - how the page helps consumers build DAG processing,
   agentic AI workflows, data pipelines, service orchestration, or plugin parts.
5. **Code Samples** - the source-backed snippets, imports, or includes a
   consumer can use as implementation reference.
6. **Details for Nerds** - deeper context about JSON-LD, registries, plugins,
   embedded DAGs, visualization, and adjacent frameworks.
7. **Related Concepts** - conceptually close pages selected from curated
   `seeAlso` frontmatter or architecture/demo links.

The code graph service is attempted first for code exploration, but the
`codebase-memory-mcp` transport is unavailable in this session. This audit uses
repository scans, Markdown section checks, source-snippet checks, and VitePress
validation commands as current-state evidence.

## Current State

- Public Markdown pages: 100
- Target pages under the consumer-grade contract: 98
- Explicit exclusions: `docs/index.md`, `docs/concepts.md`
- Pages missing canonical sections: 0
- Pages with noncanonical top-level `##` sections: 0
- Former page content migrated into canonical subsections: 793 `###` subsections
- Pages with a canonical section under 55 words: 0
- Pages without a source snippet or source include: 0
- Pages without visual/example/output evidence in the diagrams section: 0

## Page Roles

| Role | Consumer purpose |
|------|------------------|
| Runnable demos | Browser proof for real JSON-LD DAGs, registries, lifecycle events, and visual output. |
| Numbered examples | Focused examples that explain real runnable code and pair JSON-LD or builder source with Mermaid. |
| Supporting examples | Smaller concept pages that point to the runnable source instead of duplicating contrived flows. |
| Guides | Consumer instructions that connect a design problem to Dagonizer primitives and runnable demos. |
| Reference pages | Public API contracts with imports, type surfaces, examples, and related integration guidance. |
| Architecture | System-level explanation of JSON-LD DAG assembly, registries, plugins, and execution boundaries. |
| Getting started | Fast path from first install to a registered, executed, and inspectable DAG. |

## Completion Evidence

The strict section, hierarchy, source-snippet, and visual-proof scan reports no
gaps:

```json
{
  "pages": 98,
  "extraH2": 0,
  "missingPages": 0,
  "weakPages": 0,
  "noSnippet": 0,
  "noVisual": 0,
  "firstIssues": []
}
```

The scan treats prepended-only scaffolding as a failure: any noncanonical
top-level `##` heading means content still sits outside the required document
shape. The current result has no such headings; former sections such as
`DAG registration and diagram`, `Code`, `Import`, `Run`, `What it demonstrates`,
and API class/interface sections live inside the appropriate canonical section
as subsections.

## Validation

Validation commands pass for the current docs state:

- `pnpm run check:docs` - all 224 twoslash blocks type-check.
- `pnpm run typecheck:docs` - isolated `vue-tsc@3.3.7` with `typescript@6.0.3` passes.
- `pnpm run docs:build` - VitePress builds, renders pages, and generates the sitemap. The existing Rollup chunk-size warning remains informational.

## Editorial Invariants

- Non-runnable guide and example pages use Mermaid only.
- Runnable demo pages own live Cytoscape execution views.
- Example pages point to Archivist, Cartographer, and Dispatcher source where
  possible instead of inventing disconnected demonstration DAGs.
- JSON-LD and builder output remain the canonical assembly model for diagrams,
  plugin composition, and embedded DAG reuse.
