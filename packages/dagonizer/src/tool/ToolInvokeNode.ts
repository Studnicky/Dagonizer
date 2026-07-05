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
import type { SchemaObjectType } from '../contracts/NodeInterface.js';
import { MonadicNode } from '../core/MonadicNode.js';
import { Batch } from '../entities/batch/Batch.js';
import type { ItemType } from '../entities/batch/Item.js';
import type { RoutedBatchType } from '../entities/batch/RoutedBatchType.js';
import type { NodeContextType } from '../entities/node/NodeContext.js';
import { NodeErrorBuilder } from '../entities/node/NodeError.js';
import { NodeOutputBuilder } from '../entities/node/NodeOutput.js';
import type { NodeOutputType } from '../entities/node/NodeOutput.js';
import { BatchItemExecutor } from '../execution/BatchItemExecutor.js';
import type { BatchExecutionOptionsType } from '../types/BatchExecutionOptions.js';
import type { EntityValidatorInterface } from '../validation/Validator.js';

import type { ToolInterface } from './ToolInterface.js';
import { ToolInvocationState } from './ToolInvocationState.js';

export class ToolInvokeNode extends MonadicNode<ToolInvocationState, 'done' | 'error'> {
  readonly name: string;
  readonly outputs = ['done', 'error'] as const;

  /**
   * Per-port state-delta contract. `done` writes the tool result to
   * `state.output`, so the delta asserts `output` is present; the deep check
   * that the result matches the tool's own `outputSchema` is enforced
   * separately by `#outputValidator` (with the precise `toolOutputContractViolation`
   * code, before the value is written). `error` carries collected `NodeError`s,
   * not a typed state shape, so it stays an open object.
   */
  override get outputSchema(): Record<'done' | 'error', SchemaObjectType> {
    return {
      'done':  { 'type': 'object', 'properties': { 'output': {} }, 'required': ['output'] },
      'error': { 'type': 'object' },
    };
  }

  readonly #tool: ToolInterface<Record<string, unknown>, unknown>;
  readonly #inputValidator: EntityValidatorInterface<unknown>;
  readonly #outputValidator: EntityValidatorInterface<unknown>;
  readonly #execution: BatchExecutionOptionsType;

  constructor(
    name: string,
    tool: ToolInterface<Record<string, unknown>, unknown>,
    inputValidator: EntityValidatorInterface<unknown>,
    outputValidator: EntityValidatorInterface<unknown>,
    options: { readonly execution?: BatchExecutionOptionsType } = {},
  ) {
    super();
    // Initialise in declaration order — V8 shape stability.
    this.name = name;
    this.#tool = tool;
    this.#inputValidator = inputValidator;
    this.#outputValidator = outputValidator;
    this.#execution = options.execution ?? {};
  }

  override async execute(
    batch: Batch<ToolInvocationState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'done' | 'error', ToolInvocationState>> {
    const acc = new Map<'done' | 'error', ItemType<ToolInvocationState>[]>();
    const results = await BatchItemExecutor.map(batch.items(), async (item) => {
      const output = await this.#executeItem(item.state, context);

      for (const error of output.errors) {
        item.state.collectError(error);
      }
      return { item, output };
    }, this.#execution, context.signal);

    for (const result of results) {
      const bucket = acc.get(result.output.output);
      if (bucket !== undefined) {
        bucket.push(result.item);
      } else {
        acc.set(result.output.output, [result.item]);
      }
    }

    const routed = new Map<'done' | 'error', Batch<ToolInvocationState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  async #executeItem(
    state: ToolInvocationState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'done' | 'error'>> {
    try {
      // Resolve tool input from `state.input` (embeddedDAG path, seeded via
      // `inputs` mapping) or from the scatter item stored in metadata
      // (scatter/dagFrom path: scatter sets metadata[currentItem] = the scatter
      // item, which carries `arguments`). The embeddedDAG path wins when
      // `state.input` is non-empty; the scatter path is the fallback. The item
      // comes out of the `unknown`-typed metadata record and is narrowed through a
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

      // Input contract validation: gated by validateOutputs. When off (default),
      // trusted at compile-time by TypeScript types alone.
      if (context.validateOutputs && !this.#inputValidator.is(input)) {
        const violations = this.#inputValidator.errors(input) ?? ['schema mismatch'];
        const error = NodeErrorBuilder.from(
          'toolInputContractViolation',
          `Tool '${this.#tool.definition.name}' received input that violates inputSchema: ${violations.join('; ')}`,
          'ToolInvokeNode.execute',
          false,
          new Date().toISOString(),
          { 'context': { 'toolName': this.#tool.definition.name, 'violations': violations } },
        );
        return NodeOutputBuilder.of('error', { 'errors': [error] });
      }

      const result = await this.#tool.execute(input, { 'signal': context.signal });

      // Output contract validation: gated by validateOutputs.
      if (context.validateOutputs && !this.#outputValidator.is(result)) {
        const violations = this.#outputValidator.errors(result) ?? ['schema mismatch'];
        const error = NodeErrorBuilder.from(
          'toolOutputContractViolation',
          `Tool '${this.#tool.definition.name}' returned output that violates outputSchema: ${violations.join('; ')}`,
          'ToolInvokeNode.execute',
          false,
          new Date().toISOString(),
          { 'context': { 'toolName': this.#tool.definition.name, 'violations': violations } },
        );
        return NodeOutputBuilder.of('error', { 'errors': [error] });
      }

      state.output = result;
      return NodeOutputBuilder.of('done');
    } catch (thrown: unknown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      const error = NodeErrorBuilder.from(
        'toolExecutionFailed',
        message,
        'ToolInvokeNode.execute',
        false,
        new Date().toISOString(),
        { 'context': { 'toolName': this.#tool.definition.name } },
      );
      return NodeOutputBuilder.of('error', { 'errors': [error] });
    }
  }
}
