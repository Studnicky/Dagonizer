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

import { NodeOutputBuilder, ScalarNode  } from '@studnicky/dagonizer';
import type { ToolInterface } from '@studnicky/dagonizer/tool';
import type { NodeContextType, NodeOutputType, NodeStateInterface  } from '@studnicky/dagonizer/types';

export abstract class ScoutNode<
  TState extends NodeStateInterface,
  TInput extends Record<string, unknown>,
  TToolOutput,
  TItem,
> extends ScalarNode<TState, 'success' | 'empty' | 'error'> {
  constructor(protected readonly tool: ToolInterface<TInput, TToolOutput>) {
    super();
  }

  /** Build the input the tool's `run()` expects, from state. */
  protected abstract composeInput(state: TState): TInput;

  /** Normalise the tool's raw output into the consumer's item shape. */
  protected abstract normalize(output: TToolOutput): readonly TItem[];

  /** Write the normalized items back into state. */
  protected abstract writeBack(state: TState, items: readonly TItem[]): void;


  protected override async executeOne(
    state: TState,
    context: NodeContextType,
  ): Promise<NodeOutputType<'success' | 'empty' | 'error'>> {
    const input = this.composeInput(state);
    try {
      const raw = await this.tool.execute(input, { "signal": context.signal });
      const items = this.normalize(raw);
      this.writeBack(state, items);
      return NodeOutputBuilder.of(items.length === 0 ? 'empty' : 'success');
    } catch {
      return NodeOutputBuilder.of('error');
    }
  }
}
