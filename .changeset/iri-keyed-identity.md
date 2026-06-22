---
"@studnicky/dagonizer": minor
---

Keys the node and DAG registries by expanded IRI instead of bare name, so two
plugins can ship a node of the same local name without an irreconcilable
collision. A new in-house `ContextResolver` expands `prefix:local` names through
a document's `@context` prefix map (collision-free: a context that maps two
prefixes to one namespace is rejected at load); bare, un-prefixed names expand to
a default namespace, so every existing single-package DAG keeps working unchanged.

Identity keying is scoped to the node-impl and DAG maps — placement names, the
resume `cursor`, and `executedNodes`/`skippedNodes` stay DAG-local, so
deterministic resume is preserved: a stored `dagName` resolves to its IRI through
`ContextResolver` at resume time, so no checkpoint version field or migration path
is needed. The container handshake carries a `keyingScheme` (`'name'` | `'iri'`)
discriminant so a name-keyed worker isolate cannot silently bind against an
IRI-keyed parent.

The `CheckpointData` wire shape drops its `version` field entirely — checkpoints
have one current shape, and `Checkpoint.load` validates against it with no
version detection or upcasting.
