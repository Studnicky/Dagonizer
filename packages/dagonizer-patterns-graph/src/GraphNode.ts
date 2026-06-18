/**
 * GraphNode: root for triple-store-driven node patterns.
 *
 * Every pattern in this package operates against a TripleStore service
 * the consumer provides on `services.memory`. The base class itself
 * declares the service shape; concrete leaves (RecallContextNode,
 * RecordFindingsNode, MemoryDigestNode) implement specific operations.
 */

import type { NodeStateInterface } from '@studnicky/dagonizer';
import { ScalarNode } from '@studnicky/dagonizer';
import type { TripleStore } from '@studnicky/dagonizer/patterns';

export interface GraphServices {
  readonly memory: TripleStore;
}

export abstract class GraphNode<
  TState extends NodeStateInterface,
  TOutput extends string = string,
> extends ScalarNode<TState, TOutput, GraphServices> {}
