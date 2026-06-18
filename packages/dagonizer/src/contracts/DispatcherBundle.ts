/**
 * DispatcherBundle: a coherent bundle of nodes + DAGs that register together.
 *
 * Plugin packages (or feature modules) export a `DispatcherBundle` so consumers
 * register the whole unit in one call instead of iterating `registerNode` /
 * `registerDAG` themselves. Nodes register first so every DAG's references
 * resolve when the DAG's semantic validator runs.
 *
 * Both arrays are required; either may be empty (a node-only bundle uses
 * `dags: []`; a DAG-only bundle uses `nodes: []`).
 *
 * Structural contract: references only the `NodeInterface` sibling contract and
 * the `DAG` entity, so it lives in `contracts/` rather than reaching up into
 * `Dagonizer.ts`.
 */

import type { DAG } from '../entities/dag/DAG.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { NodeInterface } from './NodeInterface.js';

export interface DispatcherBundle<TState extends NodeStateInterface, TServices = undefined> {
  nodes: NodeInterface<TState, string, TServices>[];
  dags:  DAG[];
}
