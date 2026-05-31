---
'@noocodex/dagonizer': minor
---

Add `WellFormedValidator` (`./validation`): an opt-in authoring lint that flags hacky/legacy DAG shapes the structural Ajv schema cannot express — bare `null` flow-ends (route to a canonical `TerminalNode` instead), dangling output targets, and malformed scatter/embedded/terminal placements. It returns human-readable violations and is NOT wired into the permissive runtime `registerDAG` (where `null` routes remain a supported natural-end). The repo's flagship example DAGs are gated against it via a new `lint:dags` CI step.
