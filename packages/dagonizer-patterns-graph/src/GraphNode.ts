/**
 * GraphNode: root for triple-store-driven node patterns.
 *
 * Every pattern in this package operates against a TripleStoreInterface service
 * the consumer provides on `services.memory`. The base class itself
 * declares the service shape; concrete leaves (RecallContextNode,
 * RecordFindingsNode, MemoryDigestNode) implement specific operations.
 */

import { ScalarNode } from '@studnicky/dagonizer';
import type { TripleStoreInterface } from '@studnicky/dagonizer/patterns';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

export type GraphServicesType = {
  readonly memory: TripleStoreInterface;
};

export abstract class GraphNode<
  TState extends NodeStateInterface,
  TOutput extends string = string,
> extends ScalarNode<TState, TOutput, GraphServicesType> {}
