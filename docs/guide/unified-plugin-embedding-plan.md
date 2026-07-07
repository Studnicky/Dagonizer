---
title: 'Unified Plugin Embedding Plan'
description: 'Implementation plan for the unified plugin and embedded-DAG interface: plugin definitions, DAGBuilder.embed, registry loading, JSON-LD output, tests, and ordered implementation steps.'
seeAlso:
  - text: 'Plugins'
    link: './plugins'
    description: 'public plugin authoring and loading guide'
  - text: 'Example 33: Plugin-Defined DAGs'
    link: '../examples/33-plugin'
    description: 'Cartographer normalization plugin in a runnable DAG'
  - text: 'DAGBuilder'
    link: './builder'
    description: 'builder API including embed()'
---

<script setup lang="ts">
import { ingestSourceDAG, normalizeCsvDAG } from '../.vitepress/theme/exampleDags.ts';
</script>

# Unified Plugin Embedding Plan

## What It Is

This implementation note records the unified plugin and embedded-DAG interface: plugin definitions, `DAGBuilder.embed`, registry loading, JSON-LD output, tests, and ordered implementation steps.

The dev-ex target is one interface for two assembly sources. A child DAG can be local source or plugin-provided; the parent embeds a registered DAG name either way, and the canonical assembly remains JSON-LD.

## How It Works

Plugins package nodes and DAG JSON-LD with an identity scope. The dispatcher registers those parts into the same registries used by local bundles. `DAGBuilder.embed` and JSON-LD `EmbeddedDAGNode` placements reference registered DAG names regardless of whether the child came from local source or a plugin.

The useful rule is short enough to remember:

- Everything embeddable is a DAG.
- Plugin exports are DAG names.
- The builder emits the same JSON-LD placement whether the embedded DAG comes from local source or a plugin package.
- Registration validates names before execution, so a missing plugin DAG fails while assembling the host graph instead of halfway through a run.

## Diagrams, Examples, and Outputs

Example 33 is the implementation target made concrete: the Cartographer ingest DAG embeds plugin-provided normalization DAGs through the same `EmbeddedDAGNode` shape used for local child DAGs.

<DagJsonMermaid :dag="ingestSourceDAG" title="Cartographer ingest DAG embedding plugin DAGs" aria-label="Cartographer ingest JSON-LD DAG beside Mermaid generated from it." />

<DagJsonMermaid :dag="normalizeCsvDAG" title="plugin-provided normalize-csv DAG" aria-label="Plugin-provided CSV normalization JSON-LD DAG beside Mermaid generated from it." />

### Canonical JSON-LD Output

This builder call:

```ts
builder.embed('retrieve', retrievalPlugin.exports.search, {
  success: 'answer',
  error: 'failed',
}, {
  inputs: {
    query: 'question',
  },
  outputs: {
    'context.documents': 'documents',
  },
});
```

emits:

```json
{
  "@type": "EmbeddedDAGNode",
  "name": "retrieve",
  "dag": "retrieval:search",
  "outputs": {
    "success": "answer",
    "error": "failed"
  },
  "stateMapping": {
    "input": {
      "query": "question"
    },
    "output": {
      "context.documents": "documents"
    }
  }
}
```

The generated object also contains the existing `@id` field from
`DAGIdentity.placementId(...)`.

## What It Lets You Do

Use this design note when implementing or reviewing the unified plugin/embedded-DAG interface. It explains why plugin-authored DAGs, locally-authored embedded DAGs, registries, and JSON-LD assembly share one surface.

## Code Samples

The sections below are written for implementation and review. They identify the public API target, runtime invariants, tests, and rollout order.

## Details for Nerds

### Target Shape

Make this application code valid and idiomatic:

```ts
const dag = new DAGBuilder('answer-question', '1')
  .embed('retrieve', retrievalPlugin.exports.search, {
    success: 'answer',
    error: 'failed',
  }, {
    inputs: {
      query: 'question',
    },
    outputs: {
      'context.documents': 'documents',
    },
  })
  .node('answer', answerNode, {
    success: 'done',
    error: 'failed',
  })
  .terminal('done')
  .terminal('failed', { outcome: 'failed' })
  .build();

const dispatcher = new Dagonizer<QuestionState>();
dispatcher.registerPlugin(retrievalPlugin);
dispatcher.registerNode(answerNode);
dispatcher.registerDAG(dag);
```

`embed(...)` emits the same canonical `EmbeddedDAGNode` JSON-LD as the lower-level embedded-DAG primitive. A plugin export is a DAG name reference. There is no separate runtime "flow part" concept.

### Non-Goals

- Do not add a new placement type.
- Do not add a `FlowPart` runtime abstraction.
- Do not create a second plugin execution path.
- Do not make plugin exports executable objects.
- Do not change `EmbeddedDAGNode` runtime semantics.
- Do not weaken `registerDAG` validation.
- Do not make `JsonLdRenderer.render(dag)` depend on a dispatcher.

### Current Code Facts

- `DAGBuilder.embeddedDAG(...)` already creates `EmbeddedDAGNode` placements in
  `packages/dagonizer/src/builder/DAGBuilder.ts`.
- `EmbeddedDAGNode` already supports literal `dag`, runtime `dagFrom`, state
  mapping, and optional container role in
  `packages/dagonizer/src/entities/dag/EmbeddedDAGNode.ts`.
- `PluginInterface` is a one-method contract in
  `packages/dagonizer/src/contracts/PluginInterface.ts`.
- `PluginReceiverType` exposes only `registerBundle(bundle)`.
- `DispatcherBundleType` already contains `nodes`, `dags`, optional
  `stateFactories`, and optional `context`.
- `DagRegistrar.registerBundle(...)` registers nodes first, then DAGs.
- `DAGValidator` already validates literal embedded DAG references against the
  registered DAG map.
- `PluginDiscovery` already walks literal `EmbeddedDAGNode.dag` and
  `ScatterNode.body.dag` references.
- `JsonLdRenderer.render(dag)` renders one DAG document and does not read any
  registry state.

These facts are the foundation. The work is API consolidation and authoring ergonomics, not runtime redesign.

### Public API Target

#### `defineDagonizerPlugin`

Add a helper that creates a valid `PluginInterface` and exposes named DAG
exports.

```ts
export const retrievalPlugin = defineDagonizerPlugin({
  context: {
    retrieval: 'https://noocodex.dev/plugins/retrieval#',
  },
  nodes: [
    new EmbedQueryNode(),
    new VectorSearchNode(),
  ],
  dags: [
    retrievalSearchDag,
  ],
  exports: {
    search: 'retrieval:search',
  },
});
```

The returned value satisfies this shape:

```ts
type DefinedDagonizerPlugin<TExports extends Record<string, string>> =
  PluginInterface & {
    readonly context: Record<string, unknown>;
    readonly bundle: DispatcherBundleType<NodeStateInterface>;
    readonly exports: Readonly<TExports>;
  };
```

The helper must:

- Preserve literal export keys and values.
- Register exactly one bundle through `PluginReceiverType.registerBundle`.
- Validate that every exported DAG name resolves to one DAG in `dags`.
- Preserve the existing narrow plugin receiver contract.
- Avoid casts in public implementation code except `as const`.

#### `DAGBuilder.embed`

Add a user-facing alias over the existing embedded-DAG builder primitive.

```ts
embed<
  TChildState extends NodeStateInterface = NodeStateInterface,
  TParentState extends NodeStateInterface = NodeStateInterface,
>(
  name: string,
  dag: EmbeddableDAGType,
  outputs: Record<'success' | 'error', string>,
  options?: TypedEmbeddedDAGOptionsType<TChildState, TParentState>,
): this
```

`EmbeddableDAGType` is:

```ts
type EmbeddableDAGType =
  | string
  | DAGType
  | { readonly from: string };
```

Normalization:

- `string` becomes `{ dag: value }`.
- `DAGType` becomes `{ dag: value.name }`.
- `{ from }` becomes `{ dagFrom: value.from }`.

`embeddedDAG(...)` remains available and delegates through the same private
normalization path. Existing code remains valid.

#### Plugin Exports as DAG References

Plugin export values are plain DAG names:

```ts
retrievalPlugin.exports.search satisfies string;
```

They are intentionally boring. The power is that they are typed, discoverable,
and installed by `registerPlugin`, while the generated parent DAG remains plain
JSON-LD.

### Implementation Order

#### Step 1: Plugin Definition Helper

Owns:

- `packages/dagonizer/src/plugin/defineDagonizerPlugin.ts`
- `packages/dagonizer/src/plugin/index.ts`
- `packages/dagonizer/src/index.ts`
- `packages/dagonizer/src/contracts/PluginInterface.ts` only if shared types live
  with the contract
- `packages/dagonizer/tests/unit/plugin-definition.test.ts`

Build:

1. Add a `DefinedDagonizerPluginType<TExports>` public type.
2. Add a `DagonizerPluginDefinitionType<TExports>` input type.
3. Implement `defineDagonizerPlugin(definition)`.
4. Build the bundle from `definition.nodes`, `definition.dags`,
   `definition.stateFactories`, and `definition.context`.
5. Validate exported DAG names before returning the plugin.
6. Export the helper from `@studnicky/dagonizer/plugin`.
7. Re-export the helper from the root barrel only if the existing plugin loader
   root exports remain root-level.

Validation details:

- Build a `Set` of DAG names from `definition.dags`.
- For each `definition.exports` entry, verify the value exists in the DAG-name set.
- Throw `DAGError` with `code: 'PLUGIN_INVALID'` when an export does not resolve.
- Error message format:

```text
Plugin export '<key>' references unknown DAG '<dagName>'
```

Open implementation decision:

- If plugin DAGs use prefixed names and `definition.context` maps the prefix,
  decide whether export validation compares bare strings or expanded IRIs. The
  recommended first slice compares declared `dag.name` strings exactly because
  builder output stores names exactly. Registry-relative validation already
  handles IRI expansion during `registerDAG`.

Tests:

- `defineDagonizerPlugin` returns an object accepted by `PluginLoader.validate`.
- `plugin.register(receiver)` calls `receiver.registerBundle` exactly once.
- The registered bundle contains the supplied nodes, DAGs, context, and state
  factories.
- The helper preserves literal export names.
- Unknown exported DAG names throw `DAGError` with `PLUGIN_INVALID`.

#### Step 2: Unified `DAGBuilder.embed`

Owns:

- `packages/dagonizer/src/builder/DAGBuilder.ts`
- `packages/dagonizer/tests/unit/builder-embed.test.ts`

Build:

1. Add exported `EmbeddableDAGType` if it is useful to applications.
2. Add private static or private instance normalization inside `DAGBuilder`.
3. Add `embed(...)` with the same generic state mapping shape as
   `embeddedDAG(...)`.
4. Make `embeddedDAG(...)` call the same path so both methods emit identical
   placement objects.
5. Keep the current `Record<'success' | 'error', string>` output contract.

Tests:

- `embed(name, 'child', routes, options)` deep-equals
  `embeddedDAG(name, 'child', routes, options)` output.
- `embed(name, childDag, routes)` emits `dag: childDag.name`.
- `embed(name, { from: 'selectedDag' }, routes)` emits `dagFrom`.
- `embed(...)` preserves `stateMapping.input`, `stateMapping.output`, and
  `container`.
- Existing `embeddedDAG(...)` tests still pass.

#### Step 3: Plugin DAG Execution Path

Owns:

- `packages/dagonizer/tests/unit/plugin-embedded-dag.test.ts`
- Minimal source changes only if Step 1 or Step 2 exposes a missing seam.

Build:

1. Create a test plugin with one node and one DAG.
2. Export the plugin DAG name through `defineDagonizerPlugin`.
3. Create a parent DAG with `builder.embed(...)`.
4. Register plugin, parent node if needed, and parent DAG.
5. Execute parent DAG.
6. Assert child DAG state mapping and terminal routing work.

Test case shape:

- Plugin child state receives `query` through `inputs`.
- Plugin child node writes `documents`.
- Parent state receives `context.documents` through `outputs`.
- Child success routes parent to `answer`.
- Child failure routes parent to `failed`.

Acceptance:

- No plugin-specific execution code exists.
- Runtime uses existing `EmbeddedDagExecutor`.
- Registration order is plugin first, parent DAG second.

#### Step 4: Registry and Discovery Coherence

Owns:

- `packages/dagonizer/src/plugin/PluginDiscovery.ts`
- `packages/dagonizer/tests/unit/plugin-discovery.test.ts`

Build:

1. Keep `referencedDagNames(dag)` based on literal DAG references only.
2. Add tests for parent DAGs that reference plugin-exported DAG names.
3. Verify `walk(parentDag, registry)` includes parent and reachable plugin DAGs.
4. Verify `dagFrom` remains excluded from static discovery.
5. Verify scatter DAG bodies still participate in discovery.

Recommended adjustment:

- If registry maps are IRI-keyed in a caller, provide a documented helper that
  constructs a name-keyed discovery map from `dispatcher.listDAGs()`.
- Do not make `PluginDiscovery.walk(...)` mutate or register plugins.

#### Step 5: JSON-LD Reachable Forest Rendering

Owns:

- `packages/dagonizer/src/viz/JsonLdRenderer.ts`
- `packages/dagonizer/src/viz/index.ts`
- `packages/dagonizer/tests/unit/jsonld-renderer.test.ts`

Build:

1. Keep `JsonLdRenderer.render(dag)` unchanged.
2. Add `JsonLdRenderer.renderForest(entryDag, registry)` or
   `JsonLdRenderer.renderReachable(entryDag, registry)`.
3. Use `PluginDiscovery.walk(...)` to order DAGs.
4. Render each reachable DAG as normal DAG JSON-LD entries.
5. Deduplicate `@graph` entries by `@id`.
6. Keep context stable with the existing `dag` and `xsd` prefixes.

Signature target:

```ts
static renderReachable(
  entryDag: DAGType,
  registry: ReadonlyMap<string, DAGType>,
): DagJsonLdDocumentType
```

Acceptance:

- Single-DAG render output is unchanged.
- Reachable render includes parent DAG root, plugin DAG root, parent placements,
  and plugin placements.
- Runtime node implementations are not serialized.
- Missing registry entries are skipped or reported consistently with
  `PluginDiscovery.walk(...)`. Prefer skip for parity with current walk behavior.

#### Step 6: Example and Documentation

Owns:

- `examples/dags/33-plugin.ts`
- `examples/33-plugin.ts`
- `examples/tests/33-plugin.test.ts`
- `docs/guide/plugins.md`
- `docs/examples/33-plugin.md`
- `docs/.vitepress/config.ts`

Build:

1. Update the existing plugin example so it uses `defineDagonizerPlugin`.
2. Use `DAGBuilder.embed` in the parent DAG.
3. Register plugin, register parent DAG, execute.
4. Print a small deterministic output.
5. Update plugin guide with the unified rule:

```text
Everything embeddable is a DAG. Plugin exports are DAG names.
```

Acceptance:

 - Example runs with `npx tsx examples/33-plugin.ts`.
- Docs show plugin author and host application code.
- Docs do not introduce `FlowPart`.

### Detailed Source Edits

#### New File: `src/plugin/defineDagonizerPlugin.ts`

Skeleton:

```ts
import { DAGError } from '../errors/DAGError.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { NodeStateInterface } from '../NodeStateBase.js';
import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { PluginInterface, PluginReceiverType } from '../contracts/PluginInterface.js';
import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';

export type DagonizerPluginDefinitionType<TExports extends Record<string, string>> = {
  readonly context?: Record<string, unknown>;
  readonly nodes: readonly NodeInterface<NodeStateInterface, string>[];
  readonly dags: readonly DAGType[];
  readonly stateFactories?: Record<string, ChildStateFactoryType>;
  readonly exports: TExports;
};

export type DefinedDagonizerPluginType<TExports extends Record<string, string>> =
  PluginInterface & {
    readonly context: Record<string, unknown>;
    readonly bundle: DispatcherBundleType<NodeStateInterface>;
    readonly exports: Readonly<TExports>;
  };

export function defineDagonizerPlugin<TExports extends Record<string, string>>(
  definition: DagonizerPluginDefinitionType<TExports>,
): DefinedDagonizerPluginType<TExports> {
  // implementation
}
```

Implementation constraints:

- Create arrays once.
- Do not mutate input arrays.
- Do not expose mutable internal bundle arrays if avoidable.
- Preserve monomorphic object construction.
- Use `DAGError`, not generic `Error`.
- Avoid `as` casts.

#### Existing File: `src/builder/DAGBuilder.ts`

Add:

```ts
export type EmbeddableDAGType = string | DAGType | { readonly from: string };
```

Add normalization:

```ts
private static embeddedDagField(dag: EmbeddableDAGType): { dag: string } | { dagFrom: string } {
  if (typeof dag === 'string') return { dag };
  if ('from' in dag) return { dagFrom: dag.from };
  return { dag: dag.name };
}
```

Then make both `embed(...)` and `embeddedDAG(...)` use that method.

Potential type conflict:

- `DAGType` might structurally contain a `from` field in future schema changes.
  If that becomes possible, replace the `'from' in dag` branch with a dedicated
  predicate that checks `dag['@type'] === 'DAG'` first.

#### Existing File: `src/plugin/index.ts`

Export:

```ts
export { defineDagonizerPlugin } from './defineDagonizerPlugin.js';
export type {
  DagonizerPluginDefinitionType,
  DefinedDagonizerPluginType,
} from './defineDagonizerPlugin.js';
```

#### Existing File: `src/index.ts`

If root plugin exports stay root-level, add:

```ts
export { defineDagonizerPlugin } from './plugin/defineDagonizerPlugin.js';
export type {
  DagonizerPluginDefinitionType,
  DefinedDagonizerPluginType,
} from './plugin/defineDagonizerPlugin.js';
```

If the project prefers plugin utilities only on `@studnicky/dagonizer/plugin`,
do not add root exports. Keep the decision consistent with `PluginLoader` and
`PluginSpecifier`, which currently have root exports.

### Validation Matrix

| Area | Command |
| --- | --- |
| Package typecheck | `npm run typecheck` |
| Package unit tests | `npm run test` |
| Lint | `npm run lint` |
| Full local validation | `npm run validate` |

Minimum validation for each step:

- Step 1: targeted plugin definition tests plus typecheck.
- Step 2: targeted builder tests plus typecheck.
- Step 3: targeted execution test plus package unit tests.
- Step 4: targeted discovery tests.
- Step 5: JSON-LD renderer tests.
- Step 6: example execution and docs build if docs nav changes.

Final validation:

```bash
npm run validate
```

### Acceptance checklist

- [ ] `defineDagonizerPlugin` exists and exports from the plugin subpath.
- [ ] Plugin definition validates exported DAG names.
- [ ] Defined plugin validates through `PluginLoader.validate`.
- [ ] `DAGBuilder.embed` exists.
- [ ] `DAGBuilder.embed` emits the same canonical JSON-LD shape as
  `embeddedDAG`.
- [ ] `DAGBuilder.embed` accepts a plain DAG name.
- [ ] `DAGBuilder.embed` accepts a `DAGType` and emits `dag.name`.
- [ ] `DAGBuilder.embed` accepts `{ from }` and emits `dagFrom`.
- [ ] A parent DAG embeds a plugin-exported DAG name and executes.
- [ ] Static discovery finds reachable plugin DAGs through literal embedded DAG
  references.
- [ ] JSON-LD reachable rendering includes parent and plugin DAGs.
- [ ] Docs state that plugin exports are DAG names.
- [ ] No `FlowPart` abstraction exists.
- [ ] No new placement type exists.
- [ ] Existing plugin loader behavior remains valid.

### Implementation Order for a Fresh Agent

1. Read this file.
2. Read `packages/dagonizer/src/builder/DAGBuilder.ts`.
3. Read `packages/dagonizer/src/contracts/PluginInterface.ts`.
4. Read `packages/dagonizer/src/contracts/DispatcherBundle.ts`.
5. Read `packages/dagonizer/src/plugin/PluginLoader.ts`.
6. Read `packages/dagonizer/src/plugin/PluginDiscovery.ts`.
7. Implement Step 1 and run targeted tests.
8. Implement Step 2 and run targeted tests.
9. Implement Step 3 and run targeted execution tests.
10. Implement Step 4 and Step 5.
11. Add Step 6 docs and example.
12. Run `npm run validate`.

Do not start with JSON-LD rendering. The foundation is the plugin definition
helper and unified builder API. Rendering consumes the model after the model is
in place.

## Related Concepts

- [Plugins](./plugins) - public plugin authoring and loading guide for the same interface
- [Example 33: Plugin-Defined DAGs](../examples/33-plugin) - Cartographer normalization plugin in a runnable DAG
- [Example 05: Embedded DAGs](../examples/05-embedded-dags) - the same embedded-DAG interface without plugin packaging
- [DAGBuilder](./builder) - builder API including embed()
