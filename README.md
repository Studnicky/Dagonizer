<p align="center"><a href="https://studnicky.github.io/Dagonizer/"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/og-image.png" alt="Dagonizer: Omniscient orchestration for directed acyclic graphs" width="1200" /></a></p>

# @studnicky/dagonizer

> ⦿ DAG + FSM architecture framework for TypeScript: type-safe nodes, abortable execution, deterministic resume, and JSON-LD canonical wire format.

## Documentation

The full documentation is published at **https://studnicky.github.io/Dagonizer/**.

- [Getting Started](https://studnicky.github.io/Dagonizer/getting-started)
- [Architecture](https://studnicky.github.io/Dagonizer/architecture): DAG, Node, Placement kinds
- [Concepts](https://studnicky.github.io/Dagonizer/concepts): state lifecycle, placement routing, fan-out
- [DAGBuilder](https://studnicky.github.io/Dagonizer/guide/builder): fluent authoring API
- [Lifecycle / FSM](https://studnicky.github.io/Dagonizer/reference/lifecycle): DAGLifecycleMachine, state transitions
- [Cancellation & Retry](https://studnicky.github.io/Dagonizer/guide/cancellation): abort signals, deadlines, backoff strategies
- [Checkpoint / Resume](https://studnicky.github.io/Dagonizer/guide/checkpoint): deterministic pause and resume
- [Schema & JSON-LD](https://studnicky.github.io/Dagonizer/guide/schema): JSON Schema validation, canonical wire format
- [The Archivist](https://studnicky.github.io/Dagonizer/examples/the-archivist): in-browser demo running on Dagonizer

## Requirements

Node.js >= 24 (matches `engines.node` in `package.json`).

## Plugin ecosystem (v0.30.0+)

Dagonizer ships as a workspace of independently versioned plugins:

| Tier | Packages |
|---|---|
| **Adapters** (LLM backends) | `@studnicky/dagonizer-adapter-{anthropic,gemini-api,gemini-nano,ollama,web-llm}` |
| **Embedders** (vector backends) | `@studnicky/dagonizer-embedder-{gemini-api,mistral,ollama,tensorflow,transformers,web-llm}` |
| **Tools** (concrete) | `@studnicky/dagonizer-tool-{openlibrary,googlebooks,wikipedia}` |
| **Patterns** (abstract bases consumers extend) | `@studnicky/dagonizer-patterns-{rag,graph,flow}` |

Install only what you use. The main `@studnicky/dagonizer` package exposes three stable contract subpaths every plugin builds on: `./adapter`, `./patterns`, `./tool`. See the [plugins guide](https://studnicky.github.io/Dagonizer/guide/plugins) for the full story.

## Install

```bash
npm install @studnicky/dagonizer
# plus any plugins you want, for example:
npm install @studnicky/dagonizer-adapter-anthropic @studnicky/dagonizer-patterns-rag
```

The package is also mirrored to GitHub Packages as `@studnicky/dagonizer`:

```bash
echo '@studnicky:registry=https://npm.pkg.github.com' >> .npmrc
npm install @studnicky/dagonizer
```

## License

MIT. See [LICENSE](./LICENSE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) and the [GitHub releases](https://github.com/Studnicky/Dagonizer/releases).

---

## Why "Dagonizer"

The name compresses the three ideas the project is built on.

**The structure — a DAG.** The engine executes a [**D**irected **A**cyclic **G**raph][dag]: steps joined by forward-only edges, with no cycles, so the steps always admit a well-defined execution order. Engineers compose DAGs constantly — build graphs, task schedulers, spreadsheet recalculation, linker symbol resolution, and now agent tool-call chains — often without naming the structure as such. Dagonizer makes the DAG the explicit, type-safe unit of composition.

**The role — an orchestrator.** In H. P. Lovecraft's fiction, [Dagon][dagon] is the primordial deity that presides over the submerged multitudes of the Deep Ones — first evoked in the 1919 short story of the same name. The image fits an engine whose job is to marshal many small autonomous workers — LLM agents, ETL stages — through one coordinated flow. The workers are the multitude; Dagonizer is what directs them.

**The shape — ports and adapters.** Backends plug into Dagonizer through adapter contracts — `LlmAdapterInterface`, `StoreInterface`, `ClockProviderInterface`, and the rest — never through callbacks or function-passing. That is the [hexagonal "ports and adapters" architecture][hex] described by Alistair Cockburn: capabilities snap together at the boundary like interchangeable parts, and the core stays closed to modification.

Read together, **Dagonizer is "the orchestrator of the DAGs."** Spoken aloud it also resolves to *dag-on-eyes-er* — a deliberate nod to the [Eye of Dagon][eye], and to a logo that is meant to be just slightly unsettling.

[dag]: https://en.wikipedia.org/wiki/Directed_acyclic_graph
[dagon]: https://en.wikipedia.org/wiki/Dagon_%28short_story%29
[hex]: https://alistair.cockburn.us/hexagonal-architecture
[eye]: https://runescape.wiki/w/Eye_of_Dagon
