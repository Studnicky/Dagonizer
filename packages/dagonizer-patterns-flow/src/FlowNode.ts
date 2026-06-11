/**
 * FlowNode: root for pure (service-free) flow primitives.
 *
 * Pattern leaves under FlowNode handle deterministic transforms on
 * state: pick the best item, sort a list, dedupe, gate on a predicate,
 * extract a field, respond. No LLM, no triple store, no HTTP.
 */

import type { NodeStateInterface } from '@noocodex/dagonizer';
import { MonadicNode } from '@noocodex/dagonizer/patterns';

export abstract class FlowNode<
  TState extends NodeStateInterface,
  TOutput extends string = string,
> extends MonadicNode<TState, TOutput, undefined> {}
