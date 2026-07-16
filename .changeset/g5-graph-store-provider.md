---
"@studnicky/dagonizer": major
"@studnicky/dagonizer-store-file": minor
"@studnicky/dagonizer-store-sqlite": minor
"@studnicky/dagonizer-store-indexeddb": minor
"@studnicky/dagonizer-store-opfs": minor
---

Add the pluggable graph-store provider and durable append-delta journals. `GraphDatasetProviderInterface` mints the state, topology, and transfer graphs on any backend; child-state scopes carry real placement identity; `reopen` is async. The file, SQLite, IndexedDB, and OPFS stores ship real append-delta journals with blank-node skolemization, crash-safe compaction, flush-on-close, and restart resume.
