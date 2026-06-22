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

import { DAGError, NodeOutputBuilder, ScalarNode  } from '@studnicky/dagonizer';
import type { ToolInterface } from '@studnicky/dagonizer/tool';
import type { NodeContextType, NodeOutputType, NodeStateInterface  } from '@studnicky/dagonizer/types';

export type ScoutServicesType<TInput extends Record<string, unknown>, TOutput> = {
  readonly tool: ToolInterface<TInput, TOutput>;
};

export abstract class ScoutNode<
  TState extends NodeStateInterface,
  TInput extends Record<string, unknown>,
  TToolOutput,
  TItem,
> extends ScalarNode<TState, 'success' | 'empty' | 'error', ScoutServicesType<TInput, TToolOutput>> {
  /** Build the input the tool's `run()` expects, from state. */
  protected abstract composeInput(state: TState): TInput;

  /** Normalise the tool's raw output into the consumer's item shape. */
  protected abstract normalize(output: TToolOutput): readonly TItem[];

  /** Write the normalized items back into state. */
  protected abstract writeBack(state: TState, items: readonly TItem[]): void;


  protected override async executeOne(
    state: TState,
    context: NodeContextType<ScoutServicesType<TInput, TToolOutput>>,
  ): Promise<NodeOutputType<'success' | 'empty' | 'error'>> {
    const input = this.composeInput(state);
    const services = context.services;
    if (services === undefined) {
      throw new DAGError('ScoutNode requires a services record carrying a `tool`; the dispatcher was constructed without `services`.');
    }
    try {
      const raw = await services.tool.execute(input, { "signal": context.signal });
      const items = this.normalize(raw);
      this.writeBack(state, items);
      return NodeOutputBuilder.of(items.length === 0 ? 'empty' : 'success');
    } catch {
      return NodeOutputBuilder.of('error');
    }
  }
}
