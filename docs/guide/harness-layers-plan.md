---
title: 'Remaining harness layers plan'
description: 'Implementation plan for the reusable Dagonizer harness layers that still need to be built around the shared agent-flow nodes.'
seeAlso:
  - text: 'Agent harness architecture plan'
    link: './agent-harness-porting'
    description: 'High-level harness architecture and reusable node mapping'
  - text: 'Patterns surface'
    link: '../reference/dagonizer'
    description: 'Core Dagonizer engine, DAG builder, scatter, embedded DAG, and adapter contracts'
---

# Remaining Harness Layers

The reusable agent-flow nodes now cover a thin turn/tool slice:

- adapter request construction
- text-channel tool-call decoding
- tool-call partitioning
- tool dispatch and result capture

The remaining work is to turn those primitives into a library of composable layers that can be mixed into different harnesses. Each layer should stay small, explicit, and independently testable. Most of the workspace already exists; the plan below says how to reuse and extend it instead of inventing a parallel stack.

## What The Current Slice Proves

The current test proves three things:

| Proof | Meaning |
|------|---------|
| Node composition works | The new nodes can be placed into a normal Dagonizer DAG and wired through standard outputs. |
| The adapter boundary is usable | A node can build a `ChatRequestType`, call a `LlmAdapterInterface`, and store the response. |
| Text fallback is real | `ToolCallCodec` can decode tool calls from prose and feed them into the tool path. |
| Tool execution is reusable | A tool can be resolved, executed, and captured without hard-coding a harness state model. |

What it does not prove:

- permission gates
- durable resume
- memory/context retrieval
- compaction
- subagent or team orchestration
- provider/model routing
- connector and MCP lifecycles
- governance, audit, and DLP
- federated or edge execution

## Everything Is A DAG: Full Recursion From The Start

Dagonizer's composition model is the design, not an implementation detail. Three building blocks snap together like Lego and are interchangeable as composition units:

- a **node** (`NodeInterface`, usually via `ScalarNode`/`MonadicNode`) — one step
- an **embeddable DAG** — a registered flow with an entrypoint and `TerminalNode` exits
- a **parent DAG** — a flow that places nodes and embeds DAGs

Embedding is recursive without limit: a parent embeds a DAG (`DAGBuilder.embeddedDAG(name, dagName, { success, error }, { inputs, outputs })`), that DAG embeds further DAGs, and so on. The engine already proves four-level nesting (`tests/unit/embedded-dag.test.ts`). State flows down via `stateMapping.input` and back up via `stateMapping.output`; a child's `TerminalNode` outcome (`completed`/`failed`) routes the parent placement to `success`/`error`. Scatter fans the same primitive out per item — a scatter body is `{ node }` or `{ dag }`, and a per-item DAG can embed further.

The harness is built entirely on this. Three consequences are load-bearing:

1. **A tool is an embeddable DAG.** A tool carries its model-facing `definition` (JSON Schema) and resolves to a registered DAG. A leaf tool is a one-node DAG wrapping its `execute()`; a composite tool is a full DAG that embeds other tools and subagents. Dispatch embeds that DAG rather than calling a bare `execute()`.
2. **A subagent is an embeddable DAG.** A child agent is the turn-loop DAG embedded one level down, with its own state mapped in and its answer mapped out. Because the turn loop is itself an embeddable DAG, agents nest recursively — an agent runs an agent that runs a tool that is a DAG.
3. **Execution location is an orthogonal axis.** Whether an embed runs in-process or is relocated to a child process / fork / worker / web isolate (`container` role on the placement, `executor-node` / `executor-web`) is a transport decision layered on the *same* embed seam. Recursion is structural; isolation is optional decoration.

### Dispatch: the embed stays dumb; the registry is the candidate set

Two mature harnesses on disk bracket this question and agree on the answer. **claude-code** fuses selection into execution — a tool call is a name resolved against the tool list (`findToolByName`), then run; a subagent is the same `query()` loop recursed. **pi** separates them — a dispatcher selects an agent by name from a roster, and execution is a spawned process. Opposite ends of the axis, yet both hold three things invariant:

1. the executor is dumb and uniform — it runs the named thing and owns no selection logic;
2. the candidate universe is the *registry* — resolution is always name → registry lookup, route-to-error on a miss (claude-code literally returns "No such tool");
3. the recursive unit is uniform — a tool and a subagent are the same primitive resolved by name.

Dagonizer adopts the same three invariants:

- **The embed stays dumb.** `EmbeddedDAGNode` runs a dag by name. It carries no candidate set and no selection logic — it is "what happens after." Hand-authored flows keep their build-time literal name (`compose-retry-loop`), validated at `registerDAG` as today.
- **The registry is the candidate set.** The `ToolRegistry` (and, for subagents, an agent registry) is the allow-list. Dispatch resolves a name against it at runtime; an unregistered name routes the placement to `error`. No candidate arrays are stamped on placements.
- **Selection sits above the embed, lightweight, in two cardinalities.** A resolve-name node picks the dag for one child (≡ `findToolByName` / pi's `dispatch_agent`); the scatter derives each item's dag for the fan-out (≡ pi-pi's parallel `query_experts`, claude-code's parallel read-only batch). Selection writes the chosen name onto state; the embed reads it and runs.

So the engine's one new capability is narrow: **an embed can take its dag name from a runtime value — read from state (cardinality-1) or from the scatter item (cardinality-N) — instead of only a build-time literal.** The resolved name is looked up in the registry; on a miss the placement routes to `error`. `PlacementDispatch` resolves the name once (via the existing `StateAccessorInterface`) and reuses `executeEmbeddedDAG`/the scatter path unchanged, so `placementPath`, checkpoint/resume, abort, and routing are inherited. The literal path is untouched, so every existing `.embeddedDAG('name', 'dag', …)` call site and test stays green.

Tool dispatch is then: `BuildToolWorksetsNode` stamps each call with its `tool:<name>`; a scatter over the worksets resolves each item's dag against the `ToolRegistry` and embeds it. A subagent is the same at cardinality-1: a resolve-name node picks the agent dag, the embed runs it. Selection is upstream; the embed is uniform; the registry is the source of truth.

This is the keystone built first; everything else composes on it.

### Isolated child state: a tool is a pure function

A tool/subagent embed runs on a **fresh, isolated child state built by a factory**, not a clone of the parent. The embed's input-mapping seeds the child's *declared* fields; the output-mapping copies the discrete result back to the parent. A tool is a pure function — discrete args in, discrete result out — and the result returns as a value, never as a mutation of a shared state blob.

This is research-validated: claude-code (a subagent gets a fresh message history; an async child's `setAppState` is a no-op), OpenHands (a delegate gets a fresh `State`; tool I/O is discrete `Action`→`Observation` events, never shared-state mutation), and pi (subprocess isolation) all isolate. The engine's original embed cloned the *parent* state and set mapped child-keys onto it — which, when a child-key is not a declared field of the parent class (a tool's `input`/`output`), adds a property post-construction (a V8 shape-stability violation) and makes the child node's own state type a fiction. Isolated child state fixes both at the source and unifies tools and subagents on one primitive.

The engine primitive is a **DAG-scoped child-state factory**, always present — clone-parent is the *default* factory, not a conditional fallback:

- Every DAG resolves to a child-state factory `(parent: NodeStateInterface) => NodeStateInterface`. `registerDAG(dag, stateFactory = childStateDefault)` materialises the default at registration (the producer fills it; the consumer never sees absence), where `childStateDefault = (parent) => parent.clone()` reproduces today's clone-parent semantics. An isolation DAG (a tool/subagent) overrides with `(parent) => new ToolInvocationState()` — it ignores the parent and builds fresh. Carried on the bundle for `registerBundle`.
- `StateMapper.cloneChild(parent, inputMapping, factory)` is one branch-free path: `const child = factory(parent)`, then seed the input-mapping. Existing DAGs (default factory) stay byte-identical; isolation DAGs get a fresh declared-field state, so the accessor sets declared fields — no V8 violation.
- `EmbeddedDagExecutor` and `ScatterDispatch` resolve the factory by the resolved child dag name and pass it through. Scatter clones are independently resumable, so the bounded-resume reconstruction rebuilds each clone via the factory + `applySnapshot`.
- The child state is a `NodeStateBase` subclass with its own `snapshotData`/`restoreData`, so checkpoint/restore round-trips it.

`ToolInvocationState` (Wave 1) is then real and isolated: `registerDAG('tool:<name>', () => new ToolInvocationState())`, args seeded into its declared `input`, result read from its declared `output` — no cast, no V8 violation. Subagents use the same seam with an agent state.

### Architecture decisions

- **Behavior is delivered by class extension, never callbacks.** Pattern nodes are abstract bases with `protected abstract` template methods; concrete leaves subclass and override. The agent-flow nodes follow `DecisionNode`/`ScoutNode`/`ReduceNode`, not constructor-injected closures.
- **The service seam is hybrid.** Adapters and the `ToolRegistry` arrive through the typed `context.services` bag. Nodes read them through `protected` resolver methods whose default bodies read `context.services`, overridable per leaf for routing. A method override is the sanctioned extension mechanism; a default body satisfies required-with-defaults. Embedding is engine-native (a placement reference), not a service a node calls.
- **State is a typed `NodeStateBase` subclass** the node touches directly; there are no `getX`/`storeX` callbacks.
- **Dispatch separates selection from execution.** The embed runs a dag by name and owns no selection; the registry is the candidate set (name → lookup, route-to-error on miss); selection is an upstream node (cardinality-1) or the scatter (cardinality-N). Validated against claude-code (fused, registry-resolved) and pi (separated, roster-resolved) — both keep the executor dumb and the registry authoritative.

## What Already Exists In The Monorepo

The workspace already contains most of the substrate the harness needs. The missing work is orchestration and a few missing node families, not a brand-new runtime.

| Package family | Already exists | How it should evolve for the harness | Main layers |
|---|---|---|---|
| `@studnicky/dagonizer` | Core DAG/FSM engine, embedded DAGs, scatter, checkpointing, containers, adapter/tool contracts, observer hooks, execution runtime. | Add reusable agent-harness nodes under `src/patterns/agent`, plus harness-specific state types and execution events. Streaming should stay on the existing observer/execution path, with a new streaming model-call node layered on top. | Session core, turn loop, tool execution, subagents, compaction, recovery |
| `@studnicky/dagonizer-patterns-flow` | Deterministic select/reduce/gate/respond nodes. | Add flow utilities for tool workset partitioning, policy gates, compaction thresholds, result folding, and response merging. | Tool execution, governance, compaction |
| `@studnicky/dagonizer-patterns-rag` | LLM decision/compose/scout bases plus concrete leaves. | Extend the existing pattern taxonomy with harness-specific decision nodes for model routing, response normalization, memory selection, and child-session prompting. | Turn loop, memory, model/runtime, subagents |
| `@studnicky/dagonizer-patterns-graph` | RDF/triple-store memory patterns plus an in-process `RdfStore`. | Use it for transcript summaries, durable memory facts, provenance, audit trails, and graph-backed recall. Add harness-specific digest and recovery nodes instead of replacing the store. | Memory, compaction, audit, recovery |
| `@studnicky/dagonizer-store-eventlog` | Append-only event log store with optional file persistence. | Back session logs, turn checkpoints, audit events, and replay cursors. | Session core, audit, recovery |
| `@studnicky/dagonizer-store-sqlite` | SQLite-backed store. | Back durable session snapshots, task records, permission records, and eval artifacts. | Session core, tasks, evaluation |
| `@studnicky/dagonizer-executor-node` / `@studnicky/dagonizer-executor-web` | Worker-thread/fork/cluster/spawn and Web Worker isolate containers. | Run subagents, sandboxed tools, remote flows, and heavy compaction/eval jobs in explicit isolates. | Subagents, connectors, federation, evaluation |
| `@studnicky/dagonizer-adapter-*` | Concrete provider adapters for chat/model runtime. | Add capability metadata, provider profiling, parser fallback, and model routing on top of these adapters. | Model/runtime, turn loop |
| `@studnicky/dagonizer-embedder-*` | Concrete embedder adapters. | Use them as interchangeable backends for recall, ranking, compaction, and eval clustering. | Memory, compaction, evaluation |
| `@studnicky/dagonizer-tool-*` | Concrete leaf tools. | Keep them leaf-level; add registry metadata, permission classification, and result normalization around them. | Tool execution |
| `examples/the-archivist` | Full agentic orchestration example with adapter cascades, embedder cascades, tools, workers, memory, and recovery patterns. | Mine it for integration behavior and convert stable pieces into reusable nodes and tests. | All harness layers |
| `examples/the-cartographer` | Container-backed DAG orchestration and service injection patterns. | Reuse it as a reference for isolate-backed child DAGs, service swapping, and worker/container boundaries. | Subagents, federation, execution isolation |

The plan should therefore prefer extension over replacement:

- if a concern is already a package, add harness-specific nodes or services to that package family
- if a concern is already a core engine feature, expose it through a reusable node instead of duplicating runtime logic
- if a concern only exists in an example, promote the stable behavior into a shared package before adding more harness layers

## Target Layer Map

Each layer should be implemented as reusable nodes plus the services and stores those nodes consume. New packages are optional; use them only when the dependency boundary is real.

### 1. Session Core

Purpose: own the durable transcript and the minimal session state that every other layer depends on.

| Node family | Responsibility |
|-------------|----------------|
| `SessionStartNode` | Initialize a session run and correlation id. |
| `SessionAppendNode` | Append user, assistant, tool, and system entries. |
| `SessionFlushNode` | Commit queued writes at safe points. |
| `SessionReplayNode` | Rebuild state from durable entries. |
| `SessionBranchNode` | Switch branches or leaf markers. |

| Service/store | Responsibility |
|---------------|----------------|
| `SessionStore` | Durable append-only session log. |
| `PendingWriteStore` | Queue writes accepted during active runs. |
| `SessionSnapshotStore` | Persist compact turn snapshots and replay cursors. |

Acceptance:

- a run can be restarted from stored session state
- queued writes survive a turn boundary
- branch navigation does not corrupt the transcript

### 2. Turn Loop

Purpose: build the request, call the model, normalize the response, and feed the next turn. The loop ships as an embeddable DAG so a subagent embeds it recursively.

| Node family | Responsibility |
|-------------|----------------|
| `AssembleContextNode` | Merge prompt, resources, memory, and active tools. |
| `BuildChatRequestNode` | Convert harness state into `ChatRequestType`. |
| `CallModelNode` | Call the resolved adapter's `chat()` (adapter from `context.services`). |
| `NormalizeResponseNode` | Split text, tools, and mixed responses into graph outputs. |
| `DecodeTextToolCallsNode` | Text-channel fallback: decode tool calls from prose via `ToolCallCodec`. |
| `AppendAssistantNode` | Persist the assistant response into session state. |

Acceptance:

- one turn can produce either text or tool calls
- the request is a pure snapshot, not a live mutable object
- response normalization is stable across adapter variants
- the whole loop is registered as an embeddable DAG, embeddable unchanged by a subagent

### 3. Tool Execution

Purpose: classify, partition, and dispatch tool calls as embedded DAGs with explicit ordering rules.

| Node family | Responsibility |
|-------------|----------------|
| `NormalizeToolCallsNode` | Validate tool ids, names, and arguments. |
| `BuildToolWorksetsNode` | Split tool calls into safe and exclusive worksets. |
| `PermissionGateNode` | Allow, deny, or pause tool execution. |
| Tool dispatch | A scatter over the worksets whose dag body resolves each item's `tool:<name>` against the `ToolRegistry` and embeds it. A placement, not a bespoke node. |
| `CollectToolResultsNode` | Store tool outputs and tool errors (the scatter gather). |

| Service/store | Responsibility |
|---------------|----------------|
| `ToolRegistry` | The candidate set: resolve a tool name to its `definition` and embeddable DAG (`tool:<name>`); route-to-error on an unregistered name; provide active-tool views. |
| `PermissionService` | Evaluate policy and create resume records. |
| `ToolResultStore` | Persist normalized outputs and large-output references. |

Acceptance:

- a leaf tool and a composite tool DAG are dispatched through the identical embed path
- safe tool calls scatter together; exclusive tool calls stay ordered
- permission denials and asks are explicit outputs, not hidden side effects

### 4. Memory And Context

Purpose: load durable context into the prompt and extract durable facts back out.

| Node family | Responsibility |
|-------------|----------------|
| `LoadProjectMemoryNode` | Load project-specific instructions and facts. |
| `LoadUserMemoryNode` | Load user-level memory. |
| `RankMemoryNode` | Select the most relevant snippets for the current turn. |
| `InjectMemoryNode` | Add selected memory to the context snapshot. |
| `ExtractMemoryNode` | Pull durable facts from the transcript. |
| `PersistMemoryNode` | Store approved memory updates. |

Acceptance:

- memory selection can be swapped without changing the turn loop
- extracted facts are not forced into the live transcript
- the prompt can be rebuilt from stores after a restart

### 5. Compaction And Recovery

Purpose: keep long sessions usable and resumable.

| Node family | Responsibility |
|-------------|----------------|
| `EstimateTokenPressureNode` | Measure current window pressure. |
| `CompactionGateNode` | Decide whether to compact. |
| `SummarizeTranscriptNode` | Compress older messages into a durable summary. |
| `WriteCompactBoundaryNode` | Replace old transcript sections with a compact boundary. |
| `RecoverInterruptedRunNode` | Mark or retry unfinished work from durable state. |

Acceptance:

- compaction can happen without changing prompt semantics for the next turn
- recovery can distinguish interrupted, failed, and completed work
- resume logic stays explicit and policy-driven

### 6. Subagents, Tasks, And Teams

Purpose: spawn child runs, coordinate multiple agents, and collect results back into the parent. A subagent is the turn-loop DAG resolved by name and embedded through the same dispatch path that runs tools — selection is an upstream node, the embed is uniform, there is no separate subagent runtime.

| Node family | Responsibility |
|-------------|----------------|
| `ResolveAgentDefinitionNode` | The selection step: choose child model, prompt, and tool policy; write the chosen agent DAG name onto state. |
| `PrepareChildStateNode` | Map parent task state into child state (`stateMapping.input`). |
| Subagent run | A cardinality-1 embed that reads the resolved agent DAG name from state and runs it (registry-checked). |
| Team fan-out | A scatter over multiple agent definitions, each item's agent DAG resolved against the agent registry. |
| `SummarizeAgentResultNode` | Return a stable summary to the parent (`stateMapping.output`). |
| `TaskCreateNode` | Register background work and return a task ref. |
| `TaskPollNode` | Read task progress. |
| `TaskStopNode` | Cancel or abort a task. |

Acceptance:

- a subagent embed and a tool embed go through the identical resolve-name-then-embed path
- child agents run in-process by default and relocate to a container/worker by setting the placement `container` role only
- parent and child state mappings are explicit; team fan-out/fan-in preserves descriptor order

### 7. Model And Provider Runtime

Purpose: route requests to the right adapter and handle capability differences.

| Node family | Responsibility |
|-------------|----------------|
| `ResolveModelNode` | Pick a model by policy, capability, and budget. |
| `BuildStreamOptionsNode` | Freeze request-time transport options. |
| `ProbeProviderNode` | Confirm that an adapter is reachable. |
| `ResolveToolCapabilityNode` | Choose native tool, mixed, or text-channel fallback. |
| `NormalizeReasoningNode` | Convert provider-specific reasoning into stable state. |

| Service/store | Responsibility |
|---------------|----------------|
| `ModelRegistryService` | Model metadata and provider profiles. |
| `InferenceRuntimeService` | Optional local endpoint lifecycle and health checks. |
| `CapabilityStore` | Adapter capability snapshots and defaults. |

Acceptance:

- the harness can work with native tool calls or text fallback
- model metadata is data, not hard-coded branching
- provider choice is visible in state and logs

### 8. Governance, Policy, And Audit

Purpose: keep identity, permissions, DLP, and audit separate from execution.

| Node family | Responsibility |
|-------------|----------------|
| `ResolveIdentityNode` | Resolve user and tenant scope. |
| `PermissionPolicyNode` | Evaluate action/resource policy. |
| `DlpScanNode` | Scan inputs, outputs, and tool payloads. |
| `AuditEventNode` | Record important state transitions. |
| `PolicyGateNode` | Block or allow risky operations explicitly. |

Acceptance:

- policy checks can be added without changing the turn loop
- DLP can be applied to any ingress or egress path
- audit records survive failures and retries

### 9. Connectors And MCP

Purpose: load external capabilities safely and keep their credentials isolated.

| Node family | Responsibility |
|-------------|----------------|
| `DiscoverConnectorNode` | Find available connectors. |
| `ConnectorOAuthNode` | Start and complete OAuth flows. |
| `ConnectorHealthNode` | Test and monitor connectors. |
| `DiscoverMcpToolsNode` | Pull remote tools into the registry. |
| `ReadMcpResourceNode` | Load MCP resources into context. |
| `McpSecurityGateNode` | Authorize and sandbox MCP tool execution. |

Acceptance:

- dynamic capabilities can be added after session start
- credentials never need to live in node state
- remote tools are still executed through the same local dispatch path

### 10. Federation, Edge, And Proxy

Purpose: model cross-org and remote execution as explicit flows.

| Node family | Responsibility |
|-------------|----------------|
| `FederationTrustNode` | Establish or validate partner trust. |
| `FederatedMessageNode` | Send and receive remote messages. |
| `MeshTopologyNode` | Represent cross-org topology. |
| `EdgeDeviceNode` | Register edge devices and offline state. |
| `SyncNode` | Reconcile edge and cloud state. |
| `ProxyRequestNode` | Inject credentials and scan traffic through a proxy. |

Acceptance:

- cross-org flows are scanned and auditable
- edge sync can run offline and reconcile later
- proxying remains a separate service seam

### 11. Evaluation And Self-Improvement

Purpose: make prompt, skill, node, and tool changes testable before promotion.

| Node family | Responsibility |
|-------------|----------------|
| `ExperimentPlanNode` | Define a candidate change and evaluation target. |
| `RunEvaluationSuiteNode` | Execute a repeatable eval set. |
| `CompareMetricsNode` | Compare candidate vs baseline. |
| `PromotionGateNode` | Promote or reject the candidate. |
| `RollbackCandidateNode` | Restore the previous known-good version. |

Acceptance:

- candidate promotion is gated by explicit metrics
- rollback is available for every promoted change
- evaluation artifacts are stored separately from production state

## Build Order

The remaining layers should be implemented in this order:

0. Recursion foundation — tool-as-embeddable-DAG, the `ToolRegistry` as the candidate set, and the one new engine capability: an embed (and the `ScatterNode` dag body) can resolve its dag name from a runtime value against the registry, in addition to the existing build-time literal. Selection stays upstream; the embed stays dumb. Everything else composes on top of this.
1. Session core
2. Turn loop
3. Tool execution
4. Permission and policy gates
5. Memory and compaction
6. Subagents, tasks, and teams
7. Model/provider runtime
8. Connectors and MCP
9. Observability and audit
10. Federation, edge, and proxy
11. Evaluation and self-improvement

That order builds the recursion seam first, then keeps the first vertical slice small while still moving toward a complete reusable harness library.

## Concrete Update Path

The next updates should be package-first, not architecture-first:

0. Build the recursion foundation in `packages/dagonizer`: a core `ToolRegistry` (`src/tool/`) — the candidate set — that resolves a tool name to its `definition` and embeddable DAG, plus a leaf-tool-to-single-node-DAG wrapper; and the one new engine capability — `EmbeddedDAGNode` and the `ScatterNode` dag body can take their dag name from a runtime value (read from state / the scatter item) in addition to the existing build-time literal, resolved in `PlacementDispatch` via the existing `StateAccessorInterface`, looked up in the registry, route-to-error on a miss, reusing `executeEmbeddedDAG`/the scatter path. The literal path is untouched. These are the seams every later layer consumes.
1. Extend `packages/dagonizer/src/patterns/agent` with the session core, turn loop, and tool-execution nodes that every harness needs — as abstract template-method bases (`DecisionNode`/`ScoutNode` style), consuming adapters/registry/runner through `context.services`.
2. Pull the existing `patterns-rag` and `patterns-flow` abstractions toward the harness so decision, compose, gate, and reduce logic is shared instead of duplicated.
3. Add memory and recovery nodes on top of `patterns-graph`, `store-eventlog`, and `store-sqlite` so transcripts and durable facts are backed by real stores.
4. Introduce streaming model-call and provider-routing nodes that sit on top of the existing adapter packages and observer hooks.
5. Extract subagent, team, and sandbox flows into embedded DAGs that can run through `executor-node` and `executor-web` containers.
6. Fold the stable behavior from `examples/the-archivist` and `examples/the-cartographer` into testable shared nodes before expanding policy, MCP, federation, and eval layers.
