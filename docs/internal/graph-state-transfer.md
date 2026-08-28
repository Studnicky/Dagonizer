# Graph-State Transfer Contract Notes

## Scope

Defines the internal container transfer contract between the dispatcher
(`DagContainerBase`) and isolate host (`DagHost`) for DAG execution.

The worker-transfer path is now split cleanly:

- `graphStateTransferFormats`: explicit array-of-enum contract negotiation
- `ExecutionRequest.graphState` / `ExecutionResponse.graphState`: plain transient
  node-state batch payloads

The transfer path no longer switches between graph transport modes. Transient
worker state does not travel as JSON-LD or graph references.

## Format negotiation

- `graphStateTransferFormats` is explicit and array-based.
- The only supported value is `application/n-quads`.
- Default remains `['application/n-quads']` (`DEFAULT_GRAPH_STATE_TRANSFER_FORMATS`).
- `init()` sends `graphStateTransferFormats` exactly as configured.
- No normalization helper runs on init input or ready output.
- `DagHost` stores the negotiated list directly and replies with
  `ready.graphStateTransferFormats` as stored.
- `ChannelDispatch` stores `ready.graphStateTransferFormats` directly.

## Runtime batch shape

- `ExecutionRequest.graphState` is `{ states: [{ id, state }] }`.
- `ExecutionResponse.graphState` is `{ states: [{ id, state }] }`.
- Each `state` value is a `TransientNodeState` plain JSON snapshot.
- `ExecutionRequest.items[*]` is always `{ id, runIri }`.
- `ExecutionResponse.items[*]` is always `{ id, runIri, terminalOutcome }`.
- No per-item `jsonLd` field is part of container transfer payloads.

## Capabilities

- `ready.capabilities` is currently empty for graph-state transfer.
- The handshake still carries the field, but transient worker state does not
  negotiate transport backends or mode variants.

## Batch behavior

- Dispatcher batching is envelope-level, not per-item transport.
- `runDag` with one item and multiple items use the same `ExecutionRequest` shape.
- The dispatcher sends one `execute` message containing all items under one
  `correlationId`.
- The host returns one `result` message containing all item outcomes and one
  shared transient-state batch payload.
- Restore paths read that shared payload once and partition by item `id`.

## Failure behavior

- Channel send or transport failures resolve to per-item transport-error outcomes.
- A channel-scoped error (`correlationId: null`) triggers `ChannelDispatch.failAll`
  and resolves every pending request with transport errors.

## Notes

- Single-item container runs use the same batch envelope shape as multi-item runs.
- Durable graph snapshots, JSON-LD, and N-Quads remain durability/query-layer
  concerns outside this transient worker-transfer path.
