---
"@studnicky/dagonizer": minor
---
DAGDocument.load() and DAGDocument.ofValue() accept an optional overrides object merged
before validation — enables config-driven topology parameterization without mutating the
source document. registerDAG no longer runs a redundant schema validation pass; the
semantic validation (entrypoint, node references, routing completeness) is unchanged.
