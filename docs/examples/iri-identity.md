---
title: 'IRI Identity and Prefix Isolation'
description: 'Two plugins each ship a node named classify. IRI keying via @context prefix expansion lets both coexist in one dispatcher without collision.'
seeAlso:
  - text: 'Guide: IRI identity'
    link: '../guide/iri-identity'
  - text: 'Reference: Entities — DAGSchema'
    link: '../reference/entities'
  - text: 'Guide: Plugins'
    link: '../guide/plugins'
---

# IRI Identity and Prefix Isolation

## Registry Identity Surface

IRI Identity and Prefix Isolation explains how independently authored plugins can share local names without registry collisions. Two plugins can both ship a node named `classify`; `@context` prefix expansion turns each one into a different absolute IRI before registration. Names remain display and observability text only.

The registry seam shows up in unit tests and JSON-LD snippets rather than in a larger workflow walkthrough. The point is identifier expansion and collision control, not interactive execution.

## Collision and Prefix Cases

The core behavior is prefix expansion and collision detection, so JSON-LD snippets and test cases carry the signal more directly than a route diagram.

1. Two nodes with the same local name under distinct prefix contexts coexist without collision.
2. A bare `increment` and a prefixed `pluginA:increment` expand to different IRIs.
3. Registering the same node instance twice is idempotent (one entry).
4. Registering two different nodes under the same short name throws `DAGError`.
5. `ContextResolver.validate` throws on a duplicate-namespace `@context`.
6. `registerDAG` with a colliding `@context` throws before mutating the registry.

### Run

```sh
npx litany test unit
```

## Prefix Expansion Model

Registration stores node identifiers, DAG identifiers, placement identifiers, and references as canonical IRIs. Absolute IRIs pass through unchanged; declared `prefix:local` CURIEs expand through the active `@context`. Bare identifiers and undeclared prefixes are invalid. The `name` field remains display text for humans.

The host authoring rule is practical: plugin-owned names should carry plugin-owned prefixes, and every DAG that references them should declare the same prefix in `@context`.

## Code Samples

Each plugin declares a `@context` prefix that maps its short namespace to an absolute IRI. `ContextResolver.expand` performs the mapping:

```ts
import { ContextResolver } from '@studnicky/dagonizer';

const contextA = { pluginA: 'https://plugin-a.dev/dag#' };
const contextB = { pluginB: 'https://plugin-b.dev/dag#' };

ContextResolver.expand('pluginA:classify', contextA);
// → 'https://plugin-a.dev/dag#classify'

ContextResolver.expand('pluginB:classify', contextB);
// → 'https://plugin-b.dev/dag#classify'

// Bare name — no prefix declared:
ContextResolver.expand('classify', {});
// throws DAGError
```

All three expand to different IRIs. No collision is possible.

### DAG document using a prefixed node

A DAG document that references a prefixed node declares the prefix in its own `@context`:

```json
{
  "@context": {
    "pluginA": "https://plugin-a.dev/dag#"
  },
  "@id":        "urn:example:pipeline",
  "@type":      "DAG",
  "name":       "example-pipeline",
  "version":    "1",
  "entrypoints": { "main": "urn:example:pipeline/placement/classify" },
  "nodes": [
    {
      "@id":   "urn:example:pipeline/placement/classify",
      "@type": "SingleNode",
      "name":  "Classify",
      "node":  "pluginA:classify",
      "outputs": { "done": "urn:example:pipeline/placement/end" }
    },
    {
      "@id":   "urn:example:pipeline/placement/end",
      "@type": "TerminalNode",
      "name":  "End",
      "outcome": "completed"
    }
  ]
}
```

Every node reference is expanded through the document's `@context` before the DAG is stored. The `node` target `pluginA:classify` resolves to `https://plugin-a.dev/dag#classify` — the same IRI under which the node was registered. Placement `@id` values are already explicit IRIs, while `name` stays display-only.

## Operational Uses

IRI identity lets hosts combine plugins that use the same local node or DAG labels without registry collisions. It fits teams that independently ship `classify`, `extract`, `normalize`, or `route` nodes which may later run in one dispatcher.

Node and DAG registries are keyed by **expanded IRI**, not raw short names. Two plugins that both ship a node named `classify` coexist by declaring distinct `@context` prefixes - each name expands to a different absolute IRI before entering the registry.

## Runtime Notes

### The problem: short-name collision

Without IRI keying, the second `registerNode('classify', ...)` call overwrites the first. The two plugin nodes cannot coexist.

### The solution: prefix expansion

### Registering two plugins

Each plugin ships its bundle with a `context` field:

```ts
import { Dagonizer }       from '@studnicky/dagonizer';
import { ContextResolver } from '@studnicky/dagonizer';

const dispatcher = new Dagonizer();

// Plugin A — node name carries the prefix
dispatcher.registerBundle({
  nodes: [classifyNodeA],  // classifyNodeA.name === 'pluginA:classify'
  dags:  [],
  context: { pluginA: 'https://plugin-a.dev/dag#' },
});

// Plugin B — same local part, different prefix
dispatcher.registerBundle({
  nodes: [classifyNodeB],  // classifyNodeB.name === 'pluginB:classify'
  dags:  [],
  context: { pluginB: 'https://plugin-b.dev/dag#' },
});

dispatcher.nodes.size; // 2 — both nodes present, no overwrite
```

### Collision detection

`ContextResolver.validate` throws `DAGError` if two prefix keys map to the same namespace IRI. `registerDAG` calls it automatically:

```ts
import { ContextResolver } from '@studnicky/dagonizer';

// Throws: @context collision — pluginA and pluginB both map to the same namespace
ContextResolver.validate({
  pluginA: 'https://shared.example.com/',
  pluginB: 'https://shared.example.com/',
});
```

### Undeclared prefixes are refused

A compound reference like `tool:calculator` is valid only when `tool` is declared in the active `@context`. Without that declaration, registration fails before the graph enters the runtime registry.

### What the unit tests assert

The plugin composition examples in `examples/the-cartographer/plugins/NormalizeSourcesPlugin.ts` and `examples/the-cartographer/embedded-dags/IngestSourceDAG.ts` show the same registry seam in concrete workflow code.

## Related Concepts

- [Guide: IRI identity](../guide/iri-identity)
- [Reference: Entities — DAGSchema](../reference/entities)
- [Guide: Plugins](../guide/plugins)
