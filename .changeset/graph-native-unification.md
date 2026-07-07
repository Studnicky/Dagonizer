---
"@studnicky/dagonizer": major
---

Dagonizer uses a single JSON-LD front door, IRI-keyed node/DAG/state-factory registries, prefix-owned plugin bundles, the `@studnicky/dagonizer/context` subpath, and checkpoint DAG IRI persistence.

Plugin IDs are required and duplicate IDs must identify the same plugin object. Bundle context prefixes are owned by the registering plugin specifier, and `PluginSpecifier.byPrefix()` resolves `prefix:local` DAG references through that ownership map.

The container registry bundle protocol uses the same IRI-keyed registration path as in-process bundles. The raw-name registry keying seam is removed.
