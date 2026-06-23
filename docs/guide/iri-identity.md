---
title: 'IRI identity'
description: 'Node and DAG registries are keyed by expanded IRI. ContextResolver maps prefix:local names to namespace IRIs via the DAG document @context, preventing cross-plugin name collisions.'
seeAlso:
  - text: 'Reference: Entities — DAGSchema'
    link: '../reference/entities'
  - text: 'Example: IRI identity'
    link: '../examples/iri-identity'
  - text: 'Guide: Plugins overview'
    link: './plugins'
---

# IRI identity

Every node and DAG name in Dagonizer is expanded to an **absolute IRI** before it enters the registry. Two plugins that both ship a node named `classify` can coexist without collision because each resolves to a distinct IRI key.

---

## Why IRI keying

A bare name like `classify` is a local identifier: it is unique within one plugin's codebase but globally ambiguous. When two plugins register under the same dispatcher, their bare names collide.

Dagonizer addresses this by treating every name as an **expandable IRI prefix reference**, inspired by JSON-LD 1.1. The registration key is never the short name — it is always the result of `ContextResolver.expand(name, context)`.

---

## How expansion works

`ContextResolver.expand` applies four rules in order:

| Input | Rule | Result |
|-------|------|--------|
| `classify` | Bare name (no colon) | `DEFAULT_NS + 'classify'` |
| `https://myplugin.dev/dag#classify` | Absolute IRI (contains `://`) | returned as-is |
| `myPlugin:classify` where `myPlugin` is declared | Prefixed name — known prefix | `https://myplugin.dev/dag#classify` |
| `tool:calculator` where `tool` is NOT declared | Prefixed name — unknown prefix | `DEFAULT_NS + 'tool:calculator'` |

`DEFAULT_NS` is `https://noocodex.dev/dag/default#`.

Rule 4 keeps existing compound names that use colons as separators (e.g. `tool-invoke:calculator`) working without requiring callers to declare them as prefixes. Unknown prefixes fall through to `DEFAULT_NS + fullName` — they are still unique in the registry.

---

## Declaring a prefix in a DAG document

Add an `@context` object to the DAG document. Each key is a short prefix; each value is the namespace IRI to prepend:

```json
{
  "@context": {
    "myPlugin": "https://myplugin.dev/dag#"
  },
  "@id":   "urn:myplugin:intent-pipeline",
  "@type": "DAG",
  "name":  "intent-pipeline",
  "version": "1",
  "entrypoint": "myPlugin:classify",
  "nodes": [
    {
      "@id":   "urn:myplugin:intent-pipeline/node/classify",
      "@type": "SingleNode",
      "name":  "myPlugin:classify",
      "node":  "myPlugin:classify",
      "outputs": { "done": "end" }
    },
    {
      "@id":   "urn:myplugin:intent-pipeline/node/end",
      "@type": "TerminalNode",
      "name":  "end",
      "outcome": "completed"
    }
  ]
}
```

Every `name` and `node` reference inside the document is expanded through the document's own `@context` before it is stored in the registry. The short form `myPlugin:classify` is a notation convenience; `https://myplugin.dev/dag#classify` is what is stored.

---

## Declaring a prefix at bundle registration

Nodes registered through `registerBundle` use the bundle's optional `context` field:

```ts
dispatcher.registerBundle({
  nodes: [classifyNode],   // node whose .name is 'myPlugin:classify'
  dags:  [intentPipeline],
  context: {
    myPlugin: 'https://myplugin.dev/dag#',
  },
});
```

The bundle-level `context` governs node-name expansion at registration time. Each DAG's own `@context` governs how names inside that DAG resolve independently.

---

## Referencing prefixed names in output routes

Output routes in a DAG document are also expanded using the document's `@context`. You can write short prefixed names in `outputs`:

```json
"outputs": {
  "done":  "myPlugin:summarize",
  "error": "end"
}
```

`myPlugin:summarize` resolves to `https://myplugin.dev/dag#summarize` before routing occurs.

---

## Context validation

`ContextResolver.validate` checks that no two prefix keys map to the same namespace IRI. A collision would make inverse lookups ambiguous:

```ts
import { ContextResolver } from '@studnicky/dagonizer';

// Throws DAGError: @context collision
ContextResolver.validate({
  pluginA: 'https://shared.example.com/',
  pluginB: 'https://shared.example.com/',
});
```

`registerDAG` calls `ContextResolver.validate` automatically; it throws `DAGError` before mutating the registry on a colliding `@context`.

---

## Two-plugin example

Two independent plugins, each shipping a node named `classify`, coexist in one dispatcher:

```ts
import { Dagonizer }        from '@studnicky/dagonizer';
import { ContextResolver }  from '@studnicky/dagonizer';

const dispatcher = new Dagonizer();

// Plugin A registers under https://plugin-a.dev/dag#
dispatcher.registerBundle({
  nodes: [classifyNodeA],   // classifyNodeA.name === 'pluginA:classify'
  dags:  [],
  context: { pluginA: 'https://plugin-a.dev/dag#' },
});

// Plugin B registers under https://plugin-b.dev/dag#
dispatcher.registerBundle({
  nodes: [classifyNodeB],   // classifyNodeB.name === 'pluginB:classify'
  dags:  [],
  context: { pluginB: 'https://plugin-b.dev/dag#' },
});

// Two distinct IRI keys — no collision
const iriA = ContextResolver.expand('pluginA:classify', { pluginA: 'https://plugin-a.dev/dag#' });
// → 'https://plugin-a.dev/dag#classify'

const iriB = ContextResolver.expand('pluginB:classify', { pluginB: 'https://plugin-b.dev/dag#' });
// → 'https://plugin-b.dev/dag#classify'

dispatcher.nodes.get(iriA) === classifyNodeA; // true
dispatcher.nodes.get(iriB) === classifyNodeB; // true
dispatcher.nodes.size === 2;                  // true
```

---

## Bare-name backward compatibility

Nodes and DAGs registered without any `@context` continue to work. Their names expand to `DEFAULT_NS + name`. A bare `classify` becomes `https://noocodex.dev/dag/default#classify`. This is the same behavior as before IRI keying was introduced; existing code requires no changes.

---

## Related

- [`ContextResolver` source](#) — `src/dag/ContextResolver.ts`
- [Reference: Entities — `DAGSchema`](../reference/entities) — the `@context` field on `DAGType`
- [Example 31: IRI identity](../examples/iri-identity)
- [Plugins overview](./plugins)
