/**
 * AgentServicesType: typed services record for agent-flow nodes.
 *
 * Injected into `Dagonizer<TState, AgentServicesType>` at construction.
 * Nodes receive it as `context.services` and read the adapter or registry
 * they need. The default resolver methods on each node base read from this
 * record; leaf subclasses override to swap providers.
 *
 * Adapter contracts live in `src/contracts/` — single source of truth.
 * The `ToolRegistry` reference is a one-way dependency: contracts → tool.
 */

import type { ToolRegistry } from '../tool/ToolRegistry.js';

import type { LlmAdapterInterface } from './LlmAdapterInterface.js';

/** Services record for agent-flow nodes. Injected via `Dagonizer({ services })`. */
export type AgentServicesType = {
  readonly llm: LlmAdapterInterface;
  readonly tools: ToolRegistry;
};
