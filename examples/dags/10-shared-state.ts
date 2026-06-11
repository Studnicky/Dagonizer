/**
 * 10-shared-state/dags: pure module — services interface, nodes, and DAG consts.
 * No side effects, no dispatcher, no execute.
 * Imported by examples/10-shared-state.ts (the executable entry point).
 */

import {
  DAGBuilder,
  NodeOutputBuilder,
  NodeStateBase,
} from '@noocodex/dagonizer';
import type { NodeInterface } from '@noocodex/dagonizer/contracts';
import { MemoryStore } from '@noocodex/dagonizer/store';
import type { Store } from '@noocodex/dagonizer/contracts';

// ---------------------------------------------------------------------------
// Services bag type
// ---------------------------------------------------------------------------

// #region services
export interface Services {
  log: Store;
}
// #endregion services

// ---------------------------------------------------------------------------
// Nodes: each appends its own name to the store's 'entries' key
// ---------------------------------------------------------------------------

export const stepA: NodeInterface<NodeStateBase, 'done', Services> = {
  "name":    'step-a',
  "outputs": ['done'],
  async execute(_state, context) {
    await context.services.log.update<string>('entries', (current) => {
      const existing = current?.split(',').filter(Boolean) ?? [];
      return [...existing, 'step-a'].join(',');
    });
    return NodeOutputBuilder.of('done');
  },
};

export const stepB: NodeInterface<NodeStateBase, 'done', Services> = {
  "name":    'step-b',
  "outputs": ['done'],
  async execute(_state, context) {
    await context.services.log.update<string>('entries', (current) => {
      const existing = current?.split(',').filter(Boolean) ?? [];
      return [...existing, 'step-b'].join(',');
    });
    return NodeOutputBuilder.of('done');
  },
};

export const childStep: NodeInterface<NodeStateBase, 'done', Services> = {
  "name":    'child-step',
  "outputs": ['done'],
  async execute(_state, context) {
    await context.services.log.update<string>('entries', (current) => {
      const existing = current?.split(',').filter(Boolean) ?? [];
      return [...existing, 'child-step'].join(',');
    });
    return NodeOutputBuilder.of('done');
  },
};

// ---------------------------------------------------------------------------
// DAGs: child DAG placed inside the parent
// ---------------------------------------------------------------------------

// #region child-dag
export const childDag = new DAGBuilder('sub-flow', '1')
  .node('child-step', childStep, { "done": 'child-end' })
  .terminal('child-end')
  .build();
// #endregion child-dag

// #region parent-dag
// run-child is an EmbeddedDAGNode whose body is the registered 'sub-flow' DAG.
// The child shares the same services bag, so child-step appends to the same
// MemoryStore between step-a and step-b.
export const parentDag = new DAGBuilder('main-flow', '1')
  .node('step-a', stepA, { "done": 'run-child' })
  .embeddedDAG('run-child', 'sub-flow', { "success": 'step-b', "error": 'step-b' })
  .node('step-b', stepB, { "done": 'end' })
  .terminal('end')
  .build();
// #endregion parent-dag

// Re-export MemoryStore so the executable entry point can import it from here
// without adding a second direct import of the store subpath.
export { MemoryStore };
