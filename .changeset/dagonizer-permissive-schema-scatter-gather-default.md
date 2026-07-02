---
'@studnicky/dagonizer': minor
---

`ScalarNode.permissiveSchema(outputs)` builds a `{ type: 'object' }` `outputSchema` entry for every listed output name, so nodes that don't need per-port validation write `override get outputSchema() { return ScalarNode.permissiveSchema(this.outputs); }` instead of hand-writing the boilerplate record literal.

`DAGBuilder.scatter`'s `gather` option is now optional on `ScatterOptionsType`, defaulting to `{ strategy: 'discard' }` (side-effect-only fan-out) when omitted. The default is materialised in `ScatterOptions.resolve` alongside the existing `itemKey`/`reducer` defaults and exported as `SCATTER_GATHER_DEFAULT` from `@studnicky/dagonizer/builder`.
