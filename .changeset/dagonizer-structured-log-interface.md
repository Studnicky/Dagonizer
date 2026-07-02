---
'@studnicky/dagonizer': major
---

`DagLoggerInterface` (`src/ObservedDag.ts`) now uses `@studnicky/logger`'s structured call shape instead of plain strings: `trace(body)`, `debug(body)`, `info(body)` take a built `LogBodyDataType`, and `error(fault)` takes a built `LogFaultDataType`. A real `@studnicky/logger` `Logger` instance satisfies `DagLoggerInterface` directly with no adapter. `ObservedDag`'s lifecycle hooks (`onFlowStart`, `onFlowEnd`, `onNodeStart`, `onNodeEnd`, `onError`, `onPhaseEnter`, `onPhaseExit`) build each log entry via `LogBody.create()`/`LogFault.create()`, mapping `component: 'dag'`, an `operation` per hook family (`flow`, `node`, `phase`), a lifecycle `status` (`in_progress`/`complete`/`failed`), a human-readable `message`, and structured `context` (`dagName`, `nodeName`, `placementPath`, `outcome`, `phase`, `placementName`, `output`).

`package.json` gains `@studnicky/logger` as a dependency.
