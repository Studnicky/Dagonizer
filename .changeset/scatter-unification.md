---
'@noocodex/dagonizer': minor
---

`FanOutNode` and `EmbeddedDAGNode` are unified into a single `ScatterNode` (`@type: 'ScatterNode'`). `FanInConfig` is replaced by `GatherConfig`. `FanInStrategies`/`FanInStrategy`/`FanInExecution` are replaced by `GatherStrategies`/`GatherStrategy`/`GatherExecution`. `FAN_OUT_PROGRESS_KEY`/`StoredFanOutProgress`/`FanOutProgress` are replaced by `SCATTER_PROGRESS_KEY`/`StoredScatterProgress`/`ScatterProgress`. The `OutcomeReducers`/`OutcomeReducer` registry is new.

`ScatterNode` fields: `body` (`{ node }` or `{ dag }`), `source?` (absent ⇒ one clone; present ⇒ one clone per array item), `itemKey?`, `concurrency?`, `projection?` (parent → clone seed), `gather?` (`GatherConfig`), `reducer?`, `outputs`.

`GatherConfig` strategies: `map` (one clone ⇒ scalar set; N clones ⇒ index-ordered array append — the generate-collect pattern), `append`, `partition`, `custom`.

`OutcomeReducer` defaults: `aggregate` (`all-success` | `partial` | `all-error` | `empty` — default when `source` is set), `terminal` (`success` | `error` — default when absent).

Builder: `.scatter(name, body, outputs, options?)`. `.fanOut()` and `.embeddedDAG()` are removed. `ScatterOptionsInterface` replaces `FanOutOptionsInterface`, `EmbeddedDAGOptionsInterface`, and `TypedEmbeddedDAGOptionsInterface`.

Entities subpath: exports `ScatterNodeSchema`/`ScatterNode`, `GatherConfigSchema`/`GatherConfig`, `GatherStrategySchema`/`GatherStrategyName`. Constants: `GatherStrategyName` replaces `FanInStrategyName`; `ScatterOutput` replaces `FanOutOutput`; `NodeType` drops `FanOutNode` and `EmbeddedDAGNode`, adds `ScatterNode`.

Core subpath: `GatherStrategies`/`GatherStrategy`/`GatherExecution`/`GatherRecord` replace `FanInStrategies`/`FanInStrategy`/`FanInExecution`. `OutcomeReducers`/`OutcomeReducer`/`OutcomeRecord` are new.

`DAGDeriverAnnotations.fanouts` renders `ScatterNode` with `body: { node }`. `DAGDeriverAnnotations.embeddedDAGs` renders `ScatterNode` with `body: { dag }`; `stateMapping.input` becomes `projection`; `stateMapping.output` becomes a `map` gather.
