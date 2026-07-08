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

## What It Is

IRI Identity and Prefix Isolation explains how independently authored plugins can share local names without registry collisions. Two plugins can both ship a node named `classify`; `@context` prefix expansion turns each one into a different absolute IRI before registration.

This is a registry and JSON-LD identity page. The proof lives in unit tests and small JSON-LD snippets rather than a browser DAG demo.

## How It Works

Registration expands node names, DAG names, placement names, and references through the active `@context` before storing them. The registry key is the expanded absolute IRI. Bare names still work by expanding into the default namespace, while prefixed names expand into plugin-owned namespaces.

The application authoring rule is practical: plugin-owned names should carry plugin-owned prefixes, and every DAG that references them should declare the same prefix in `@context`.

## Diagrams, Examples, and Outputs

This page has JSON-LD snippets instead of a Mermaid graph because the interesting behavior is registry identity, not route topology.

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

## What It Lets You Do

IRI identity lets applications combine plugins that use the same local node or DAG names without registry collisions. Use it when teams independently ship `classify`, `extract`, `normalize`, or `route` nodes that may later run in one dispatcher.

Node and DAG registries are keyed by **expanded IRI**, not raw short names. Two plugins that both ship a node named `classify` coexist by declaring distinct `@context` prefixes — each name expands to a different absolute IRI before entering the registry.

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
// → 'https://noocodex.dev/dag/default#classify'
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
  "entrypoints": { "main": "pluginA:classify" },
  "nodes": [
    {
      "@id":   "urn:example:pipeline/node/classify",
      "@type": "SingleNode",
      "name":  "pluginA:classify",
      "node":  "pluginA:classify",
      "outputs": { "done": "end" }
    },
    {
      "@id":   "urn:example:pipeline/node/end",
      "@type": "TerminalNode",
      "name":  "end",
      "outcome": "completed"
    }
  ]
}
```

Every `name` and `node` string in the document is expanded through the document's `@context` before the DAG is stored. The `entrypoints.main` target `pluginA:classify` resolves to `https://plugin-a.dev/dag#classify` — the same IRI under which the node was registered.

## Details for Nerds

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

### Rule 4: unknown prefixes are safe

A compound name like `tool:calculator` where `tool` is not declared in any `@context` falls through to Rule 4: it expands to `DEFAULT_NS + 'tool:calculator'`. Existing code that uses colons as separators requires no migration — the name remains unique in the registry at the default namespace.

### What the unit tests assert

The unit test at `packages/dagonizer/tests/unit/iri-identity.test.ts` asserts the collision and isolation cases listed above.

## Related Concepts

- [Guide: IRI identity](../guide/iri-identity)
- [Reference: Entities — DAGSchema](../reference/entities)
- [Guide: Plugins](../guide/plugins)
