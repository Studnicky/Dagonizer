/**
 * DispatcherBundleType: a coherent bundle of nodes + DAGs that register together.
 *
 * Plugin packages (or feature modules) export a `DispatcherBundleType` so consumers
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

import type { DAGType } from '../entities/dag/DAG.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

import type { ChildStateFactoryType } from './ChildStateFactoryType.js';
import type { NodeInterface } from './NodeInterface.js';

export type DispatcherBundleType<TState extends NodeStateInterface, TServices = undefined> = {
  /** Nodes to register; registered before `dags` so DAG references resolve. */
  nodes: NodeInterface<TState, string, TServices>[];
  /** DAGs to register; their node references must resolve against `nodes`. */
  dags:  DAGType[];
  /**
   * Per-DAG child-state factories keyed by DAG name. When a DAG name is absent
   * from this map, `ChildStateFactory.cloneParent` (clone-parent) is used.
   * Omitting the field entirely is equivalent to an empty map — all DAGs in the
   * bundle receive the default factory.
   */
  stateFactories?: Record<string, ChildStateFactoryType>;
  /**
   * Optional `@context` prefix map for IRI expansion of node names in this
   * bundle. Keys are short prefixes (e.g. `myplugin`); values are namespace
   * IRI strings (e.g. `https://myplugin.example/nodes#`). When absent, bare
   * node names are expanded using `ContextResolver.DEFAULT_NS`.
   *
   * Each DAG's own `@context` governs expansion of names inside that DAG.
   * This bundle-level context supplements node-name expansion at registration.
   */
  context?: Record<string, unknown>;
}
