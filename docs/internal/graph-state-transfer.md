# Graph-State Transfer Contract Notes

## Scope

Defines the graph-state transfer contract between a dispatcher (`DagContainerBase`)
and an isolate host (`DagHost`) for containerized DAG execution. Two orthogonal
axes are negotiated:

- **Serialization format** — how graph state is encoded on the wire
  (`graphStateTransferFormats`). N-Quads always; JSON-LD additive.
- **Transfer mode** — how the payload is delivered (`inline-nquads`, `graph-ref`,
  `shared-endpoint`, `inline-delta-nquads`, `delta-ref`). This is the axis that
  governs performance; see [Performance](#performance-characteristics).

## Format negotiation

- `graphStateTransferFormats` is an explicit format-array contract, not a boolean.
- Allowed values: `application/n-quads`, `application/ld+json`.
- Default is `['application/n-quads']` (`DEFAULT_GRAPH_STATE_TRANSFER_FORMATS`).
- `normalizeGraphStateTransferFormats` always seeds the N-Quads default, then
  appends caller-provided formats de-duplicated. N-Quads is therefore always
  present; it is the mandatory baseline and is never negotiated away.
- JSON-LD is additive: when `application/ld+json` is negotiated
  (`supportsJsonLd`), the host attaches a real `jsonLd` derived from state via
  `NodeStateBase.snapshotJsonLd`. When it is not negotiated, `jsonLd` is omitted
  entirely — no placeholder payload.

Handshake:

- Parent sends `init` with optional `graphStateTransferFormats`.
- Host normalizes, stores them, and replies `ready` with the normalized list
  plus its transfer-mode `capabilities`.
- `ChannelDispatch` stores both (`graphStateTransferFormats`, `capabilities`) for
  subsequent `execute` requests.

## Transfer-mode capabilities

Distinct from serialization formats. `DagHost` advertises modes in the `ready`
`capabilities` array:

- `inline-nquads` is **mandatory and unadvertised** — every host supports it, so
  it is not listed as an optional capability.
- `['graph-ref', 'shared-endpoint', 'inline-delta-nquads', 'delta-ref']` are
  advertised **only when a `graphStateTransferStore` is injected**; without a
  store, the capability list is empty and only inline transfer is available.

The mode actually used is driven by the inbound request's `graphState.mode`
(`requested?.mode` in `DagHost.#graphStateOf`), defaulting to `inline-nquads`
when the request carries no prior graph state.

## Returned graph state (inline path)

For the default inline path the host returns:

- `mode: 'inline-nquads'`, `format: 'application/n-quads'`
- `nquads` payload + integrity metadata (`hash`, `byteSize`, `quadCount`)
- `jsonLd` only when JSON-LD was negotiated

The hash is a SHA-256 over the full serialized payload; `apply`/`restore` reject
on any mismatch.

## Batch transfer

Batching is at the request/response envelope level.

`ExecutionRequest`:

- `items: ExecutionRequestItem[]`, `minItems: 1`.
- Each item is `{ id, graphState }`. **`graphState` is required by the schema**
  (`required: ['id', 'graphState']`); the host still tolerates its absence
  defensively, but the wire contract mandates it.

`ExecutionResponse`:

- `items: ExecutionResponseItem[]`, one entry per request item.
- Each item is `{ id, graphState, terminalOutcome }`.

Container behavior:

- `runDagBatch` + `ChannelDispatch.requestBatch` send **one** `execute` message
  carrying all items under **one** `correlationId`.
- The response `items[]` is mapped to `BatchRunResultType[]` **positionally, in
  array order**; `id` travels with each entry for caller-side identity, but the
  restore loop relies on preserved order, not id lookup.

## Failure behavior

- Transport/serialization failures resolve to per-item transport-error outcomes
  (`terminalOutput: 'failed'`, one error, empty intermediates) via
  `DagOutcome.batchItemTransportError` — the batch never partially mutates
  formats or throws.
- A channel-scoped error (`correlationId: null`) routes through
  `ChannelDispatch.failAll`, settling every pending request and rejecting an
  in-flight init.

**Negotiated formats are always satisfiable.** Both `application/n-quads` and
`application/ld+json` are lossless projections of the same run dataset:
`snapshotGraph` exports the quads, `snapshotJsonLd` encodes the identical quad
set through `GraphStateJsonLdCodec`. Any state that yields N-Quads yields
JSON-LD, so JSON-LD negotiation never downgrades or fails — it is purely
additive. There is no "unsatisfiable format" branch because the contract admits
no unsatisfiable format; a genuine per-item production failure surfaces through
the normal transport-error / `errors` path, not through format negotiation.

## Performance characteristics

The **transfer mode**, not the serialization format, is the performance lever.

**Inline mode fully materializes — it does not stream to the wire.** Despite the
`inlineStream` / `snapshotGraph` async-iterable surface, the inline path buffers
the whole payload several times before a single `send`:

1. `DagHost.#graphStateOf` drains `snapshotGraph` into a `quads[]` array, then
   re-wraps it via `asyncQuads`.
2. `GraphStateTransferCodec.inlineStream` accumulates every chunk into a
   `chunks[]` array, `join('')`s it into one `nquads` string, then SHA-256-hashes
   that whole string.

Peak memory therefore holds the quad array, the chunk array, and the joined
string simultaneously, ~proportional to graph size. For large graphs prefer:

- **`graph-ref`** — `referenceStream` streams quads into an injected store while
  hashing incrementally; only a reference (not the payload) rides the message.
- **`shared-endpoint`** — the host writes to a leased shared store; the message
  carries only the lease.
- **`inline-delta-nquads` / `delta-ref`** — send only additions/deletions when
  the peer already holds a base snapshot, avoiding full-graph re-serialization.

These require a `graphStateTransferStore`; without one, only inline is available
and large-graph transfers pay the full-materialization cost.

**Batch is one large message — a round-trip win, a memory/latency cost.** A
single `execute`/`result` pair for all N items eliminates per-item message
overhead, but the whole response (all N items' full payloads) is assembled and
sent atomically: peak memory ~ sum of all item payloads, and no early delivery
of items that finish first. Batch is the right default for many small graphs;
for few large graphs, per-item `runDag` (or a reference mode) trades round-trips
for lower peak memory and earlier first results.

**Batch response `intermediates` is empty.** The batch path relays node results
live over the channel and leaves `ExecutionResponse.intermediates` as `[]` — it
does not buffer per-node results into the response, avoiding O(N×M) retention.
The single-item path still buffers `intermediates` into the response.

**Per-item graph state is resolved in O(N).** The batch response builder reads
each restored item's requested `graphState` from the value already in scope
rather than re-scanning the item list per entry; success and failure paths are
both O(N), not O(N²).

## Notes

- Single-item container runs share the same transport shape (`items[0]`).
