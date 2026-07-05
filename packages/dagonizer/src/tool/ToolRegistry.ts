/**
 * ToolRegistry: the candidate set for tool dispatch.
 *
 * Each registered tool synthesizes a one-node `tool:<name>` embeddable DAG.
 * Consumers embed that DAG by name; the registry IS the candidate set —
 * resolution is a simple name lookup, not a scanning loop.
 *
 * Duplicate registration throws `DAGError` (matching the engine's own
 * duplicate-name semantics). `resolve` returns `null` on a miss so the
 * embed's route-to-error path handles the unregistered case without throwing.
 *
 * `bundle()` returns `DispatcherBundleType<ToolInvocationState>` — all
 * synthesized nodes + DAGs — so `dispatcher.registerBundle(registry.bundle())`
 * wires the whole tool surface in one call.
 */

import { DAGBuilder } from '../builder/DAGBuilder.js';
import type { ChildStateFactoryType } from '../contracts/ChildStateFactoryType.js';
import type { DispatcherBundleType } from '../contracts/DispatcherBundle.js';
import type { ToolDefinitionType } from '../entities/adapter/ToolDefinition.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DAGError } from '../errors/DAGError.js';
import type { BatchExecutionOptionsType } from '../types/BatchExecutionOptions.js';
import type { EntityValidatorInterface } from '../validation/Validator.js';
import { Validator } from '../validation/Validator.js';

import type { ToolInterface } from './ToolInterface.js';
import { ToolInvocationState } from './ToolInvocationState.js';
import { ToolInvokeNode } from './ToolInvokeNode.js';

/** In-memory lookup result for a registered tool. Not a wire shape — no schema required. */
export type ResolvedToolType = {
  /** The tool's JSON-Schema declaration. */
  readonly 'definition': ToolDefinitionType;
  /** The synthesized embeddable DAG name (`tool:<name>`). */
  readonly 'dagName': string;
};

type RegistryEntry = {
  readonly 'definition': ToolDefinitionType;
  readonly 'tool': ToolInterface<Record<string, unknown>, unknown>;
  readonly 'nodeName': string;
  readonly 'dag': DAGType;
  readonly 'dagName': string;
  readonly 'inputValidator': EntityValidatorInterface<unknown>;
  readonly 'outputValidator': EntityValidatorInterface<unknown>;
  readonly 'execution': BatchExecutionOptionsType;
};

export class ToolRegistry {
  readonly #entries: Map<string, RegistryEntry>;
  readonly #execution: BatchExecutionOptionsType;

  constructor(options: { readonly execution?: BatchExecutionOptionsType } = {}) {
    this.#entries = new Map<string, RegistryEntry>();
    this.#execution = options.execution ?? {};
  }

  /**
   * Register a tool. Synthesizes a `tool:<name>` DAG (one `ToolInvokeNode`
   * placement; two terminals: `end` / `end-fail`). The entry is keyed by
   * `tool.definition.name`; duplicate registration throws `DAGError`.
   */
  register(tool: ToolInterface<Record<string, unknown>, unknown>, options: { readonly execution?: BatchExecutionOptionsType } = {}): void {
    const toolName = tool.definition.name;

    if (this.#entries.has(toolName)) {
      throw new DAGError(
        `ToolRegistry: duplicate registration for '${toolName}'`,
        { 'code': 'TOOL_DUPLICATE_REGISTRATION' },
      );
    }

    const nodeName = `tool-invoke:${toolName}`;
    const dagName  = `tool:${toolName}`;

    // Compile validators once at registration time; `Validator.compile` routes
    // through the shared Ajv instance and caches by `$id` — no new Ajv instances.
    const inputValidator  = Validator.compile<unknown>(tool.definition.inputSchema);
    const outputValidator = Validator.compile<unknown>(tool.definition.outputSchema);

    // Build the synthesized DAG from a default-typed node (the builder reads its
    // `name`). The registered node instances are constructed per `bundle()` call
    // so the synthesized DAG node is discarded after the DAG is built.
    const execution = options.execution ?? this.#execution;
    const dag = new DAGBuilder(dagName, '1')
      .node(
        'invoke',
        new ToolInvokeNode(nodeName, tool, inputValidator, outputValidator, { execution }),
        { 'done': 'end', 'error': 'end-fail' },
      )
      .terminal('end')
      .terminal('end-fail', { 'outcome': 'failed' })
      .build();

    this.#entries.set(toolName, {
      'definition':      tool.definition,
      'tool':            tool,
      'nodeName':        nodeName,
      dag,
      dagName,
      inputValidator,
      outputValidator,
      execution,
    });
  }

  /**
   * Resolve a tool name to its definition and synthesized DAG name.
   * Returns `null` when the tool is not registered.
   */
  resolve(name: string): ResolvedToolType | null {
    const entry = this.#entries.get(name);
    if (entry === undefined) return null;
    return { 'definition': entry['definition'], 'dagName': entry['dagName'] };
  }

  /**
   * All registered tool definitions in insertion order.
   */
  definitions(): readonly ToolDefinitionType[] {
    return [...this.#entries.values()].map((e) => e['definition']);
  }

  /**
   * All registered tool names in insertion order.
   */
  names(): readonly string[] {
    return [...this.#entries.keys()];
  }

  /**
   * All synthesized nodes + DAGs + child-state factories as a
   * `DispatcherBundleType`. Pass to `dispatcher.registerBundle(registry.bundle())`
   * to wire the full tool surface into the dispatcher in one call.
   *
   * Each `tool:<name>` DAG registers an isolation factory `() => new
   * ToolInvocationState()`, so a tool runs on its OWN fresh state — args are
   * seeded into the embed's `input`, the result read from `output`, and the
   * parent's state is never mutated by the tool. A tool is a pure function.
   */
  bundle(): DispatcherBundleType<ToolInvocationState> {
    const nodes: ToolInvokeNode[] = [];
    const dags: DAGType[] = [];
    const stateFactories: Record<string, ChildStateFactoryType> = {};

    for (const entry of this.#entries.values()) {
      // Construct each node. The node gets its tool via the constructor.
      // Validators compiled once at `register()` time are passed through here; no recompilation.
      nodes.push(new ToolInvokeNode(entry['nodeName'], entry['tool'], entry['inputValidator'], entry['outputValidator'], { 'execution': entry['execution'] }));
      dags.push(entry['dag']);
      stateFactories[entry['dagName']] = () => new ToolInvocationState();
    }

    return { 'nodes': nodes, 'dags': dags, 'stateFactories': stateFactories };
  }
}
