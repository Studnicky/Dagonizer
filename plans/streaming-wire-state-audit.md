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

- `ExecutionRequest.graphState.states[]`
  - one transient snapshot per item
  - built in [DagContainerBase.ts](/Users/studs/Workspace/Dagonizer/packages/dagonizer/src/container/DagContainerBase.ts:340)
- `ExecutionRequest.items[]`
  - `{ id, runIri }` only
- `ExecutionRequest.responseState`
  - return projection contract only
  - built from gather/embedded placement needs

Important current fact:

- send-side batching still snapshots each item with `state.snapshotTransientState()`
- return-side projection is selective
- input-side projection is not selective

So the host already knows less is needed on the way back than on the way in, but the request path still sends the full transient snapshot for every item in the batch.

### 2.2 Host restore and response

The host restores each item from the request batch in [DagHost.ts](/Users/studs/Workspace/Dagonizer/packages/dagonizer/src/container/DagHost.ts:309).

On completion it computes one response batch in [DagHost.ts](/Users/studs/Workspace/Dagonizer/packages/dagonizer/src/container/DagHost.ts:456):

- route output is derived per item
- selection is chosen from `responseState.outputSelections[routeOutput] ?? defaultSelection`
- `snapshotTransientStateSelection(selection)` produces the returned per-item state

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

The child needs only the fields required to continue execution from the selected entry point.

It does not need:

- parent presentation summaries
- fields owned only by downstream gathers
- browser-facing aggregates that are not read by the child path

Current violation:

- `snapshotTransientState()` sends all transient fields for every contained item unless a concrete state class manually trims them
- Cartographer works around this in [CartographerState.ts](/Users/studs/Workspace/Dagonizer/examples/the-cartographer/CartographerState.ts:686), but the framework default is still broad

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

### 4.1 Request boundary: over-broad input snapshot

`DagContainerBase.#composeRequest()` snapshots every item's full transient state with no input selection step.

Effect:

- batching reduces message count
- batching does not reduce per-item payload width
- large item batches still pay for fields the child body never reads

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
- compatibility source-stream fields

The cartographer override trims what crosses worker boundaries, but the state type itself still mixes ownership domains heavily.

---

## 5. Dispatcher-facing design implications

### 5.1 Separate input selection from response selection

The framework already has an explicit response contract. It needs an equally explicit input contract for contained execution.

Required outcome:

- the dispatcher computes the child input surface from the placement/body entry requirements
- request batching carries only that selected transient input state per item

Without this, send-side payload width remains “full clone state by default”.

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

### A. Audit send-side child input requirements

For dispatcher/container paths, identify which fields each contained body actually reads before its first mutation.

Primary targets:

- embedded DAG entry
- scatter DAG body
- retained gather replay

Deliverable:

- one framework contract for child input selection

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

The issue is:

- the same state object currently serves execution, gather replay, durability, and presentation concerns
- response projection is explicit, but input projection is not
- batching exists, but batched items still carry wider-than-needed state on multiple paths

The dispatcher work should therefore focus on contract boundaries first:

1. child input surface
2. child result surface
3. retained replay surface
4. browser presentation surface

If those are explicit and narrow, the batching strategy starts working with the framework instead of masking waste inside larger envelopes.
