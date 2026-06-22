---
"@studnicky/dagonizer": minor
---

Adds five framework-tooling surfaces that consumers previously hand-rolled:

- **`./runner`** — `DagRunner`, an abstract base owning the canonical
  register → seed → execute → route → project loop (never-throw), plus a
  `TriggerInterface` adapter contract with four concrete triggers
  (`OnceTrigger`, `CliTrigger`, `EventTrigger`, `RequestTrigger`). The
  `request` trigger is the seam for per-turn dispatcher scope; the runner wires
  the previously-missing checkpoint/resume entry point.
- **`AgentBuilder`** (`./patterns`) — assembles the eight-node agent tool-calling
  loop (including the tool-scatter sub-graph and the loop-back edge) into a
  runnable `DAGType` from one call, replacing the hand-wired `DAGBuilder` chain
  every agent consumer re-derived.
- **`LoggedScalarNode`** (`./core`) — a `ScalarNode` base that owns the
  try/route discipline so subclasses cannot throw past the node boundary;
  an escaped throw is caught, routed to `error`, and surfaced as a named
  node-contract violation in dev mode.
- **`./progress`** — `EventBus` (typed topic publish/subscribe) and `SseStream`
  (a bus topic → Server-Sent-Events stream with heartbeat and teardown), an
  isomorphic, dependency-free progress substrate.
- **`LlmAdapterCascadeBuilder`** (`./adapter`) — assembles a configured
  `LlmAdapterCascade` from a provider catalogue expressed as data (no `switch`),
  lifting the provider-cascade glue consumers re-derive.
