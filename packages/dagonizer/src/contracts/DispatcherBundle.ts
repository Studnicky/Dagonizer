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

export type DispatcherBundleType<TState extends NodeStateInterface> = {
  /**
   * Optional package/specifier id that owns this bundle's context prefixes.
   * Plugin-authored bundles populate this from the plugin id so prefix-based
   * discovery can resolve `prefix:dag` references to the owning module.
   */
  specifier?: string;
  /** Nodes to register; registered before `dags` so DAG references resolve. */
  nodes: NodeInterface<TState, string>[];
  /** DAGs to register; their node references must resolve against `nodes`. */
  dags:  DAGType[];
  /**
   * Per-DAG child-state factories keyed by expanded DAG IRI. When a DAG IRI is absent
   * from this map, `ChildStateFactory.cloneParent` (clone-parent) is used.
   * Omitting the field entirely is equivalent to an empty map — all DAGs in the
   * bundle receive the default factory.
   */
  stateFactories?: Record<string, ChildStateFactoryType>;
  /**
   * Optional `@context` prefix map owned by this bundle. Node objects register
   * by their own `@id`; the bundle context records plugin prefix ownership for
   * discovery and DAG-reference resolution.
   */
  context?: Record<string, unknown>;
}
