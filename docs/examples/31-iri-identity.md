---
title: 'Example 31: IRI identity and prefix isolation'
description: 'Two plugins each ship a node named classify. IRI keying via @context prefix expansion lets both coexist in one dispatcher without collision.'
seeAlso:
  - text: 'Guide: IRI identity'
    link: '../guide/iri-identity'
  - text: 'Reference: Entities — DAGSchema'
    link: '../reference/entities'
  - text: 'Guide: Plugins overview'
    link: '../guide/plugins'
---

# Example 31: IRI identity and prefix isolation

Node and DAG registries are keyed by **expanded IRI**, not bare name. Two plugins that both ship a node named `classify` coexist by declaring distinct `@context` prefixes — each name expands to a different absolute IRI before entering the registry.

## The problem: bare-name collision

Without IRI keying, the second `registerNode('classify', ...)` call overwrites the first. The two plugin nodes cannot coexist.

## The solution: prefix expansion

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

## Registering two plugins

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

## DAG document using a prefixed node

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
  "entrypoint": "pluginA:classify",
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

Every `name` and `node` string in the document is expanded through the document's `@context` before the DAG is stored. The entrypoint `pluginA:classify` resolves to `https://plugin-a.dev/dag#classify` — the same IRI under which the node was registered.

## Collision detection

`ContextResolver.validate` throws `DAGError` if two prefix keys map to the same namespace IRI. `registerDAG` calls it automatically:

```ts
import { ContextResolver } from '@studnicky/dagonizer';

// Throws: @context collision — pluginA and pluginB both map to the same namespace
ContextResolver.validate({
  pluginA: 'https://shared.example.com/',
  pluginB: 'https://shared.example.com/',
});
```

## Rule 4: unknown prefixes are safe

A compound name like `tool:calculator` where `tool` is not declared in any `@context` falls through to Rule 4: it expands to `DEFAULT_NS + 'tool:calculator'`. Existing code that uses colons as separators requires no migration — the name remains unique in the registry at the default namespace.

## What the IRI identity test verifies

The unit test at `packages/dagonizer/tests/unit/iri-identity.test.ts` asserts:

1. Two nodes with the same bare name under distinct prefix contexts coexist without collision.
2. A bare `increment` and a prefixed `pluginA:increment` expand to different IRIs.
3. Registering the same node instance twice is idempotent (one entry).
4. Registering two different nodes under the same bare name throws `DAGError`.
5. `ContextResolver.validate` throws on a duplicate-namespace `@context`.
6. `registerDAG` with a colliding `@context` throws before mutating the registry.

Run it with:

```sh
npx litany test unit
```
