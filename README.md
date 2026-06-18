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

## Plugin ecosystem (v0.10.0+)

Dagonizer ships as a workspace of independently versioned plugins:

| Tier | Packages |
|---|---|
| **Adapters** (concrete) | `@studnicky/dagonizer-adapter-{gemini-api,gemini-nano,web-llm,groq,cerebras,mistral,openrouter,stub}` |
| **Tools** (concrete) | `@studnicky/dagonizer-tool-{openlibrary,googlebooks,wikipedia}` |
| **Patterns** (abstract bases consumers extend) | `@studnicky/dagonizer-patterns-{rag,graph,flow}` |

Install only what you use. The main `@studnicky/dagonizer` package exposes three stable contract subpaths every plugin builds on: `./adapter`, `./patterns`, `./tool`. See the [plugins guide](https://studnicky.github.io/Dagonizer/guide/plugins) for the full story.

## Install

```bash
npm install @studnicky/dagonizer
# plus any plugins you want, for example:
npm install @studnicky/dagonizer-adapter-groq @studnicky/dagonizer-patterns-rag
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
