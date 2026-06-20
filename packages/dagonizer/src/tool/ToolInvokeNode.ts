/**
 * ToolInvokeNode: executes a bound `ToolInterface` instance.
 *
 * Reads `state.input`, calls `tool.execute(input, { signal })`, writes the
 * result to `state.output`, and routes `done`. On any throw it collects a
 * `NodeError` (camelCase code) and routes `error`. Nodes never throw past
 * this boundary.
 *
 * The tool instance is injected at construction — a collaborator object, not
 * a callback. The node name is passed explicitly so the same class can be
 * instantiated once per tool (each instance has its own unique `name`).
 */

import { SCATTER_ITEM_KEY_DEFAULT } from '../builder/ScatterOptions.js';
import { ScalarNode } from '../core/ScalarNode.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../entities/node/NodeOutput.js';

import type { ToolInterface } from './ToolInterface.js';
import { ToolInvocationState } from './ToolInvocationState.js';

export class ToolInvokeNode<TServices = undefined> extends ScalarNode<ToolInvocationState, 'done' | 'error', TServices> {
  readonly name: string;
  readonly outputs = ['done', 'error'] as const;

  readonly #tool: ToolInterface<Record<string, unknown>, unknown>;

  constructor(name: string, tool: ToolInterface<Record<string, unknown>, unknown>) {
    super();
    // Initialise in declaration order (name first, tool second) — V8 shape stability.
    this.name = name;
    this.#tool = tool;
  }

  protected async executeOne(
    state: ToolInvocationState,
    context: NodeContextType<TServices>,
  ): Promise<NodeOutputType<'done' | 'error'>> {
    try {
      // Resolve tool input from `state.input` (embeddedDAG path, seeded via
      // `inputs` mapping) or from the scatter item stored in metadata
      // (scatter/dagFrom path: scatter sets metadata[currentItem] = the scatter
      // item, which carries `arguments`). The embeddedDAG path wins when
      // `state.input` is non-empty; the scatter path is the fallback. The item
      // comes out of the `unknown`-typed metadata bag and is narrowed through a
      // type guard — no cast.
      const inputFromState = state.input;
      const scatterItem = state.getMetadata(SCATTER_ITEM_KEY_DEFAULT);
      const itemArgs =
        ToolInvocationState.isArgumentRecord(scatterItem) && ToolInvocationState.isArgumentRecord(scatterItem['arguments'])
          ? scatterItem['arguments']
          : null;
      const input =
        Object.keys(inputFromState).length > 0
          ? inputFromState
          : (itemArgs ?? inputFromState);
      const result = await this.#tool.execute(input, { 'signal': context.signal });
      state.output = result;
      return NodeOutputBuilder.of('done');
    } catch (thrown: unknown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      const error = NodeErrorBuilder.from(
        'toolExecutionFailed',
        message,
        'ToolInvokeNode.executeOne',
        false,
        new Date().toISOString(),
        { 'context': { 'toolName': this.#tool.definition.name } },
      );
      return NodeOutputBuilder.of('error', { 'errors': [error] });
    }
  }
}
