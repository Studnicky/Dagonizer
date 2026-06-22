/**
 * GraphNode: root for triple-store-driven node patterns.
 *
 * Every pattern in this package operates against a `TripleStoreInterface`
 * injected into the node's constructor and held as `this.memory`. Concrete
 * leaves (RecallContextNode, RecordFindingsNode, MemoryDigestNode) implement
 * specific operations against it.
 */

import { ScalarNode } from '@studnicky/dagonizer';
import type { TripleStoreInterface } from '@studnicky/dagonizer/patterns';
import type { NodeStateInterface } from '@studnicky/dagonizer/types';

export abstract class GraphNode<
  TState extends NodeStateInterface,
  TOutput extends string = string,
> extends ScalarNode<TState, TOutput> {
  constructor(protected readonly memory: TripleStoreInterface) {
    super();
  }
}
