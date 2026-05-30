/**
 * GraphNode: root for triple-store-driven node patterns.
 *
 * Every pattern in this package operates against a TripleStore service
 * the consumer provides on `services.memory`. The base class itself
 * declares the service shape; concrete leaves (RecallContextNode,
 * RecordFindingsNode, MemoryDigestNode) implement specific operations.
 */

import { MonadicNode } from '@noocodex/dagonizer/patterns';
import type { TripleStore } from '@noocodex/dagonizer/patterns';
import type { NodeStateInterface } from '@noocodex/dagonizer';

export interface GraphServices {
  readonly memory: TripleStore;
}

export abstract class GraphNode<
  TState extends NodeStateInterface,
  TOutput extends string = string,
> extends MonadicNode<TState, TOutput, GraphServices> {}
