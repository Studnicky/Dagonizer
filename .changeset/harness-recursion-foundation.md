---
"@studnicky/dagonizer": minor
---

Harness recursion foundation: isolated child-state engine, per-port output contracts, and repo-wide cast elimination.

- **Isolated child-state harness.** Tool and subagent embeds run on a fresh child state produced by a factory seam, not a clone of the parent state. The engine is now honestly heterogeneous-state: a child DAG carries its own `NodeStateBase` subtype, decoupled from the parent's. Tool state is isolated; scatter `dagFrom` is item-scoped so each scattered item materialises its own child DAG.
- **Agent turn-loop + tool-execution node family.** New template-method pattern nodes for the agent turn-loop and tool-execution flow, extensible by subclass.
- **Mandatory per-port `outputSchema` node contract.** Every `NodeInterface` declares `readonly outputSchema: Record<TOutput, SchemaObjectType>`; `MonadicNode.outputSchema` is abstract with no passthrough default. Opt-in output validation runs as a dedicated `validateOutputs` lifecycle stage (`fire → validate → route`), gated by `DagonizerOptionsType.validateOutputs` (default `false`). Tool input/output contracts validate against `tool.definition.inputSchema`/`outputSchema`.
- **Tool-registry dispatch.** Tool invocation routes through the registry by name with route-to-error on miss; validators compile once at `ToolRegistry.register()`.
- **Non-generic `BaseStore` hooks** and repo-wide elimination of `as` casts in favour of static type-guard predicates, `filter*` builders, and membership checks. Zero sanctioned casts remain, including the JSON snapshot/restore boundary.
