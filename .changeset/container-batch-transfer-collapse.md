---
"@studnicky/dagonizer": major
---

Collapse the container transport to a single batch-native path: `DagContainerInterface.runDag(task, batch, options?)` always accepts a `Batch<NodeStateInterface>` and returns `RunResultType[]` — a single item is a batch of one through the identical path, so there is no separate single-item transport. `ChannelDispatch` exposes one `request()` method (the former `request()`/`requestBatch()` split is gone). `GraphStateTransferCodec` exposes `inline`/`inlineSync`/`reference`/`shared`/`delta`/`restore` (the `combine*`/`splitTransfer` names are gone). `DagOutcome.transportError(id, correlationId, options?)` always returns an id-bearing `RunResultType`; `RunResultType` is exported from `./contracts` and re-exported from `./container`.
