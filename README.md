<p align="center"><a href="https://nodejs.org/api/"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/nodejs-node.svg" alt="Node.js" width="36" height="36" /></a><a href="https://www.typescriptlang.org/"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/typescript-node.svg" alt="TypeScript" width="64" height="64" /></a><a href="https://studnicky.github.io/Dagonizer/"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/dagonizer-node.svg" alt="Dagonizer" width="112" height="112" /></a><a href="https://studnicky.github.io/Dagonizer/guide/builder"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/dag-node.svg" alt="DAG" width="48" height="48" /></a><a href="https://studnicky.github.io/Dagonizer/reference/lifecycle"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/fsm-node.svg" alt="FSM" width="48" height="48" /></a><a href="https://studnicky.github.io/Dagonizer/guide/schema"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/jsonld-node.svg" alt="JSON-LD" width="48" height="48" /></a><a href="https://www.w3.org/TR/rdf12-concepts/"><img src="https://raw.githubusercontent.com/Studnicky/Dagonizer/main/docs/public/rdf-node.svg" alt="RDF" width="64" height="64" /></a></p>

# @noocodex/dagonizer

> ⦿ DAG + FSM architecture framework for TypeScript: type-safe nodes, abortable execution, deterministic resume, and JSON-LD canonical wire format.

## Documentation

The full documentation is published at **https://studnicky.github.io/Dagonizer/**.

- ⦿ [Getting Started](https://studnicky.github.io/Dagonizer/getting-started)
- ⦿ [Architecture](https://studnicky.github.io/Dagonizer/architecture) — DAG, Node, Placement kinds
- ⦿ [Concepts](https://studnicky.github.io/Dagonizer/concepts) — state lifecycle, placement routing, fan-out
- ⦿ [DAGBuilder](https://studnicky.github.io/Dagonizer/guide/builder) — fluent authoring API
- ⦿ [Lifecycle / FSM](https://studnicky.github.io/Dagonizer/reference/lifecycle) — DAGLifecycleMachine, state transitions
- ⦿ [Cancellation & Retry](https://studnicky.github.io/Dagonizer/guide/cancellation) — abort signals, deadlines, backoff strategies
- ⦿ [Checkpoint / Resume](https://studnicky.github.io/Dagonizer/guide/checkpoint) — deterministic pause and resume
- ⦿ [Schema & JSON-LD](https://studnicky.github.io/Dagonizer/guide/schema) — JSON Schema validation, canonical wire format
- ⦾ [The Archivist](https://studnicky.github.io/Dagonizer/examples/the-archivist) — in-browser demo running on Dagonizer

## Requirements

Node.js >= 24 (matches `engines.node` in `package.json`).

## Install

```bash
npm install @noocodex/dagonizer
```

The package is also mirrored to GitHub Packages as `@noocodex/dagonizer`:

```bash
echo '@noocodex:registry=https://npm.pkg.github.com' >> .npmrc
npm install @noocodex/dagonizer
```

## License

MIT — see [LICENSE](./LICENSE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) and the [GitHub releases](https://github.com/Studnicky/Dagonizer/releases).
