/**
 * ScoutNode: canonical "call a ToolInterface, normalise, write back" pattern.
 *
 * The scout reads from state to build a tool input, invokes the tool,
 * normalises the response into the consumer's entity shape, and writes
 * the result back to state. Subclasses inject the four domain points:
 * input build, normalisation, write-back, and the tool reference.
 *
 * The Archivist's per-source scouts (openLibraryScout, googleBooksScout,
 * wikipediaScout, subjectScout) are one-class subclasses of ScoutNode
 * that plug in a specific ToolInterface instance.
 */

import { Batch, BatchItemExecutor, MonadicNode, NodeError, NodeOutput } from '@studnicky/dagonizer';
import type { BatchExecutionOptionsType, ItemType, RoutedBatchType } from '@studnicky/dagonizer';
import type { ToolInterface } from '@studnicky/dagonizer/tool';
import type { NodeContextType, NodeOutputType, NodeStateInterface } from '@studnicky/dagonizer/types';

export abstract class ScoutNode<
  TState extends NodeStateInterface,
  TInput extends Record<string, unknown>,
  TToolOutput,
  TItem,
> extends MonadicNode<TState, 'success' | 'empty' | 'error'> {
  readonly #execution: BatchExecutionOptionsType;

  constructor(
    protected readonly tool: ToolInterface<TInput, TToolOutput>,
    options: { readonly execution?: BatchExecutionOptionsType } = {},
  ) {
    super();
    this.#execution = options.execution ?? {};
  }

  /** Build the input the tool's `execute()` expects, from state. */
  protected abstract composeInput(state: TState): TInput;

  /** Normalise the tool's raw output into the consumer's item shape. */
  protected abstract normalize(output: TToolOutput): readonly TItem[];

  /** Write the normalized items back into state. */
  protected abstract writeBack(state: TState, items: readonly TItem[]): void;

  override async execute(
    batch: Batch<TState>,
    context: NodeContextType,
  ): Promise<RoutedBatchType<'success' | 'empty' | 'error', TState>> {
    const acc = new Map<'success' | 'empty' | 'error', ItemType<TState>[]>();
    const results = await BatchItemExecutor.map(batch.items(), async (item) => {
      const output = await this.executeItem(item.state, context);

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

    const routed = new Map<'success' | 'empty' | 'error', Batch<TState>>();
    for (const [output, items] of acc) {
      routed.set(output, Batch.from(items));
    }
    return routed;
  }

  private async executeItem(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'empty' | 'error'>> {
    try {
      const input = this.composeInput(state);
      const raw = await this.tool.execute(input, { 'signal': context.signal });
      const items = this.normalize(raw);
      this.writeBack(state, items);
      return NodeOutput.create(items.length === 0 ? 'empty' : 'success');
    } catch (thrown: unknown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      const error = NodeError.create(
        'scoutExecutionFailed',
        message,
        'ScoutNode.execute',
        false,
        new Date().toISOString(),
        { 'context': { 'toolName': this.tool.definition.name } },
      );
      return NodeOutput.create('error', { 'errors': [error] });
    }
  }
}
