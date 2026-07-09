---
title: 'IRI Identity'
description: 'Node and DAG registries are keyed by expanded IRI. ContextResolver maps prefix:local references through the DAG document @context, preventing cross-plugin collisions while name remains display/observability text.'
seeAlso:
  - text: 'Reference: Entities — DAGSchema'
    link: '../reference/entities'
  - text: 'IRI Identity and Prefix Isolation'
    link: '../examples/iri-identity'
  - text: 'Guide: Plugins'
    link: './plugins'
---

# IRI Identity

## What It Is

IRI identity is how Dagonizer lets independently authored plugins share a dispatcher without fighting over short labels. A plugin can publish a node displayed as `classify`, another plugin can publish its own `classify`, and both can run in one application because registry keys are expanded IRIs, not bare strings. Names are display and observability text only.

`ContextResolver` maps `prefix:local` references through a DAG or bundle `@context`. The short form is what people can read and write; the expanded IRI is what the registry stores.

## How It Works

Every registry key is an explicit IRI. Absolute IRIs pass through unchanged, and declared prefixes expand through the active JSON-LD-style `@context`. Unknown prefixes and short names fail validation; the runtime does not synthesize identities.

Every node reference, DAG reference, and DAG `@id` is expanded to an **absolute IRI** before it enters the registry. Two plugins that both ship a node labeled `classify` can coexist without collision because each resolves to a distinct IRI key.

## Diagrams, Examples, and Outputs

IRI identity is registry behavior, not graph topology, so this page uses focused JSON-LD and registration snippets instead of a Mermaid graph. The supporting example and unit tests prove the collision cases:

- [IRI Identity and Prefix Isolation](../examples/iri-identity) shows the application-level rule set.
- `packages/dagonizer/tests/unit/iri-identity.test.ts` verifies prefix isolation, duplicate rejection, and `@context` validation.
- [Example 33: Plugin-Defined DAGs](../examples/33-plugin) shows plugin-provided DAGs embedded by a parent flow.

### Referencing prefixed registry names

The `node`, `dag`, phase `node`, and scatter body references in a DAG document are expanded using the document's `@context`. Output routes target placement IRIs inside the same DAG, so they are not registry lookups.

```json
{
  "@context": {
    "myPlugin": "https://myplugin.dev/dag#"
  },
  "name": "intent-pipeline",
  "entrypoints": { "main": "urn:myplugin:intent-pipeline/node/summarize" },
  "nodes": [
    {
      "@id": "urn:myplugin:intent-pipeline/node/summarize",
      "@type": "SingleNode",
      "name": "summarize",
      "node": "myPlugin:summarize",
      "outputs": { "done": "urn:myplugin:intent-pipeline/node/end" }
    },
    {
      "@id": "urn:myplugin:intent-pipeline/node/end",
      "@type": "TerminalNode",
      "name": "end",
      "outcome": "completed"
    }
  ]
}
```

`myPlugin:summarize` resolves to `https://myplugin.dev/dag#summarize` before the node registry lookup occurs. The `"done"` route remains a placement-to-placement edge over placement IRIs.

## What It Lets You Do

### Use when

Use IRI identity when multiple plugins, packages, or teams may register the same local node or DAG labels in one dispatcher. Prefix-scoped references let `classify`, `normalize`, or `route` coexist without forcing every application to invent globally unique display names.

## Code Samples

### Why IRI keying

A short name like `classify` is a local identifier: it is unique within one plugin's codebase but globally ambiguous. When two plugins register under the same dispatcher without declaring prefixes, their short names resolve to the same default-namespace IRI.

Dagonizer addresses this by treating every name as an **expandable IRI prefix reference**, inspired by JSON-LD 1.1. The registration key is never the short name - it is always the result of `ContextResolver.expand(name, context)`.

### How expansion works

`ContextResolver.expand` applies two accepted rules:

| Input | Rule | Result |
|-------|------|--------|
| `https://myplugin.dev/dag#classify` | Absolute IRI (contains `://`) | returned as-is |
| `myPlugin:classify` where `myPlugin` is declared | Prefixed name — known prefix | `https://myplugin.dev/dag#classify` |

Bare names such as `classify` and undeclared prefixes such as `tool:calculator` fail immediately. If a string identifies runtime behavior, it is an IRI, not a display label.

### Declaring a prefix in a DAG document

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
  "entrypoints": { "main": "myPlugin:classify" },
  "nodes": [
    {
      "@id":   "urn:myplugin:intent-pipeline/node/classify",
      "@type": "SingleNode",
      "name":  "myPlugin:classify",
      "node":  "myPlugin:classify",
      "outputs": { "done": "urn:myplugin:intent-pipeline/node/end" }
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

The DAG `@id`, `node` references, and DAG references inside the document are expanded through the document's own `@context` before registry lookup. The short form `myPlugin:classify` is a notation convenience; `https://myplugin.dev/dag#classify` is what is stored. Placement `name` stays as display and observability text.

### Declaring a prefix at bundle registration

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

### Context validation

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

### Two-plugin example

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

### No Default Namespace

Nodes and DAGs register under the exact absolute IRI they declare, or under the expanded IRI produced by a declared JSON-LD prefix. There is no default namespace and no short-reference authoring mode. Placement `name` is for diagrams, logs, and operator-facing text only.

## Details for Nerds

### What expands, and when

Bundle registration expands node references through the bundle `context`. DAG registration expands the DAG `@id` through the DAG `@context`. Child-state factory records are keyed by the expanded DAG IRI. Execution resolves node references, embedded DAG references, scatter body references, phase-node references, and validation lookups through the relevant DAG context before registry lookup.

Route targets inside a single DAG are placement IRIs, not registry keys. A route such as `"done": "urn:workflow:agent/node/normalize"` points to another placement in the same `nodes` array; a placement's `node` or `dag` field points to something in the registry and receives IRI expansion.

## Related Concepts

- [Reference: Entities — DAGSchema](../reference/entities)
- [Example: IRI identity](../examples/iri-identity)
- [Guide: Plugins](./plugins)
- [Example 33: Plugin-Defined DAGs](../examples/33-plugin)
