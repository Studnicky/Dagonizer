# Streaming Wire Shapes And State Surface Audit

Internal note for the dispatcher/state redesign. This is not product documentation.

---

## 1. Why this audit exists

The current redesign plan already splits transient transfer from durable state, but the code still carries multiple concerns through the same mutable state object:

- execution-local fields a child needs in order to continue work
- gather-visible fields the parent needs in order to fold a completion
- durable fields needed for resume
- presentation fields consumed by the browser demo

That overlap makes the transport heavier than it needs to be and hides where the real cost sits.

This audit maps the current shapes and identifies what each layer actually needs to know.

---

## 2. Current wire shapes

### 2.1 Container request

Contained execution uses one batched request shape:

- `ExecutionRequest.graphState`
  - one codec-backed `application/n-quads` transfer for the whole batch
  - one selected transient-state RDF literal per item named graph
  - one N-Quads encode and integrity hash per batch
- `ExecutionRequest.items[]`
  - `{ id, runIri }` only
- `DagTask.inputState`
  - required child-input projection contract
  - applies identically to single-item and batched requests
- `ExecutionRequest.responseState`
  - return projection contract only
  - built from gather/embedded placement needs

Current contract:

- embedded input `domainPaths` are the child-side keys from `stateMapping.input`
- scatter DAG-body input adds the explicit `itemKey` and `itemIndex` metadata keys
- send-side batching snapshots every item with `snapshotTransientStateSelection(task.inputState)` and encodes the selected snapshots together
- return-side projection is selective

The task contract is engine-internal. `ExecutionRequest` carries the selected state in the negotiated graph transfer rather than repeating the selection descriptor on the wire.

### 2.2 Host restore and response

The host restores each item from the request batch in [DagHost.ts](/Users/studs/Workspace/Dagonizer/packages/dagonizer/src/container/DagHost.ts:309).

On completion it computes one response batch in [DagHost.ts](/Users/studs/Workspace/Dagonizer/packages/dagonizer/src/container/DagHost.ts:456):

- route output is derived per item
- selection is chosen from `responseState.outputSelections[routeOutput] ?? defaultSelection`
- `snapshotTransientStateSelection(selection)` produces each returned state literal
- `GraphStateTransferCodec.inlineTransient()` encodes all returned state literals in one N-Quads transfer

This is the cleanest contract in the current design:

- the host returns only what the caller declares it needs
- the caller does not get the whole child clone back by default

### 2.3 Gather checkpoint records

Gather checkpointing still has two modes in [GatherBuffers.ts](/Users/studs/Workspace/Dagonizer/packages/dagonizer/src/execution/GatherBuffers.ts:127):

- reduced record with `contribution`
- retained record with `graphState: record.cloneState.snapshotTransientState()`

This means bounded folds are already on the right track, but any path that cannot compact to a contribution still serializes full clone state into gather progress.

### 2.4 Scheduler and workset state

The non-container scheduler paths still snapshot full transient state in several places:

- workset progress
- gather progress retention
- checkpoint capture

The core issue is broader than container transport. The same state envelope is still used as:

- execution continuation payload
- retained gather replay payload
- durable checkpoint payload

---

## 3. What each layer actually needs to know

### 3.1 Child execution

The child receives only the fields declared by the placement input mapping plus framework control state. Scatter DAG bodies also receive the configured work-item metadata.

It does not need:

- parent presentation summaries
- fields owned only by downstream gathers
- browser-facing aggregates that are not read by the child path

The contained dispatcher path enforces this surface through required `DagTask.inputState`. In-process execution still uses the live child clone and therefore remains a separate state-isolation concern.

### 3.2 Parent gather/fold

The parent gather needs only the fields its strategy reads.

This is already modeled explicitly:

- built-in gather strategies declare `transientResultSelection()`
- scatter response selection is assembled in [TransientResultSelection.ts](/Users/studs/Workspace/Dagonizer/packages/dagonizer/src/execution/TransientResultSelection.ts:73)

This contract is good. The waste is that it applies only to the returned terminal child state, not to the child input surface or every retained-progress path.

### 3.3 Durable resume

Durable resume needs:

- scatter watermark and bounded ack bookkeeping
- bounded fold accumulator or append-only fold contribution journal
- retained per-item replay payload only for strategies that truly require it

It does not need:

- every browser-facing derived field at every completion boundary
- every clone-local scratch field if replay can proceed from a compact contribution

### 3.4 Browser presentation

The browser demo needs a narrow live state surface while streaming:

- exact progress scalar
- bounded sample feed
- bounded insights aggregate
- bounded journey sample
- bounded error rollup

It does not need:

- full `records` during a million-event stream
- clone-local ingest/geocode/GDPR scratch fields
- duplicate representations of the same data for both execution and display

Recent Cartographer changes already move in this direction:

- `processedCountExact` avoids rescanning insights for progress
- `sampleRecords` stays bounded and ring-aware

That is the right direction, but it is still an app-level optimization over a framework-level state contract that remains too wide.

---

## 4. Current waste by boundary

### 4.1 Request boundary: selected input snapshot

`DagContainerBase.#composeRequest()` snapshots every item through the task's required input selection.

Effect:

- batching reduces message count
- input selection reduces per-item payload width
- a reservoir batch carries one selected transient state literal per item in one combined N-Quads transfer

### 4.2 Response boundary: correct contract, partial coverage

The return path is the best-designed part:

- per-output selection
- one batched response
- parent restores only the selected child surface

Gap:

- that contract is not the only state movement path
- workset/gather/checkpoint paths still move broader snapshots

### 4.3 Gather retention: full clone replay where contribution would do

When gather progress cannot be reduced to a contribution, the engine stores `graphState` for the clone.

This is correct for:

- custom/finalize paths that truly need retained clone records

This is wasteful for:

- any strategy that can express replay as contribution-only but has not been converted yet

### 4.4 App state: one object playing too many roles

`CartographerState` still contains:

- durable aggregate fields
- clone-local scratch fields
- UI-facing sample and summary fields
- the one canonical source-payload stream

The cartographer override trims what crosses worker boundaries, but the state type itself still mixes ownership domains heavily.

---

## 5. Dispatcher-facing design implications

### 5.1 Input selection and response selection are separate contracts

Contained execution uses two required task contracts:

- `inputState` selects the child input surface sent to the host
- `responseState` selects the terminal child surface returned to the parent

The dispatcher computes `inputState` from the placement mapping and scatter item metadata. There is no inferred full-state fallback.

### 5.2 Treat gather selection as the canonical parent-facing contract

`transientResultSelection()` is the right abstraction for parent fold needs.

The dispatcher should use that contract consistently across:

- contained scatter response projection
- retained gather progress shapes
- any replay journal that stores per-item state fragments

One contract is enough. It just needs to govern every parent-facing child-state surface, not only one return path.

### 5.3 Promote contribution-first replay

For streaming and durable modes, the preferred replay unit is:

- contribution
- not clone state

Full clone snapshots remain only for gathers that structurally require them.

This is the main path to reducing retained-progress size without losing correctness.

### 5.4 Keep browser state as a view model, not the execution envelope

The browser should consume a bounded presentation surface derived from execution state, not execution scratch space itself.

For Cartographer that means the live UI contract stays close to:

- `processedCountExact`
- `sampleRecords`
- `sampleRecordsCursor`
- `sampleRecordsWrapped`
- `insights`
- `journeys`
- `errorRollup`

Everything else belongs to execution, not live presentation.

---

## 6. Concrete follow-up work

### A. Child input contract

Dispatcher/container paths use the placement contract as the child input requirement:

- embedded DAG entry selects child keys from `stateMapping.input`
- scatter DAG bodies select those child keys plus `itemKey` and `itemIndex`
- `DagTask.inputState` applies the selection to every item in a container batch

Retained gather replay remains part of section B because it is parent-facing state retention rather than child-input transport.

### B. Audit retained gather paths

Classify every gather strategy and cartographer custom fold into:

- contribution-only replay
- retained-result replay
- full-clone replay

Deliverable:

- reduce full-clone retention to the smallest unavoidable set

### C. Split Cartographer state surfaces

Document Cartographer fields by ownership:

- execution scratch
- fold accumulator
- durable checkpoint
- browser presentation

Deliverable:

- a narrow browser-facing live state contract
- less accidental coupling between runtime and demo UI

### D. Revisit batching policy after width is fixed

The system already batches returns and node-to-node transport. The remaining question is not whether to batch, but what width each batched item carries.

Do not change batching policy first.

First:

- shrink per-item state surface

Then:

- re-evaluate batch sizes and flush cadence with real payload widths

---

## 7. Immediate conclusions

The main framework issue is not “browser cannot handle a million points” in isolation.

The remaining issue is:

- the same state object currently serves execution, gather replay, durability, and presentation concerns
- input and response projection are explicit at the container boundary
- retained replay, durable checkpoint, and browser presentation paths still carry broader state than their consumers require

The remaining state-surface work follows these boundaries:

1. retained replay surface
2. durable fold and watermark surface
3. browser presentation surface

The contained batching strategy carries narrow per-item input and output envelopes. The durability and presentation paths must preserve the same bounded-surface discipline.
