/**
 * PluginDiscovery: static DAG-walker for finding declared DAG references.
 *
 * Consumers use this utility to discover which plugin DAGs a given entry DAG
 * transitively depends on, so they can register the right plugins before
 * executing.
 *
 * Literal references and dynamic `DagReference` values contribute DAG IRIs.
 * Discovery walks the DAG's
 * declared entrypoint roots through routing edges so dead placements do not
 * inflate the reachable plugin set.
 */

import type { PluginInterface } from '../contracts/PluginInterface.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagGraphProjector } from '../graph/DagGraphProjector.js';
import { DagGraphQueries } from '../graph/DagGraphQueries.js';

import { PluginLoader } from './PluginLoader.js';

/**
 * Static DAG-walker for discovering sub-DAG references in the reachable DAG
 * topology.
 *
 * Each method is a pure function over immutable inputs; no side effects.
 */
export class PluginDiscovery {
  private constructor() { /* static-only */ }

  /**
   * Collect all referenced DAG IRIs from the canonical graph projection.
   */
  static referencedDagIris(dag: DAGType): readonly string[] {
    return DagGraphQueries.reachableCandidateDagIris(DagGraphProjector.store(dag));
  }

  /**
   * Walk a DAG forest breadth-first: entry DAG + all reachable sub-DAGs
   * referenced by literal or dynamic candidate `dag` fields.
   *
   * Returns the ordered list of all DAG IRIs reachable from `dag` (including
   * the entry DAG itself at index 0). DAGs absent from `registry` are skipped
   * silently — the caller is responsible for ensuring the registry is populated
   * before execution.
   *
   * Cycle-safe: each IRI is visited at most once.
   */
  static walk(dag: DAGType, registry: ReadonlyMap<string, DAGType>): readonly string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const queue: DAGType[] = [dag];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const dagIri = DagGraphProjector.dagIri(current);
      if (visited.has(dagIri)) continue;
      visited.add(dagIri);
      result.push(dagIri);

      for (const refIri of PluginDiscovery.referencedDagIris(current)) {
        if (!visited.has(refIri)) {
          const refDag = registry.get(refIri);
          if (refDag !== undefined) {
            queue.push(refDag);
          }
        }
      }
    }

    return result;
  }

  /**
   * Load all plugin modules referenced in the DAG forest and register them on
   * the dispatcher.
   *
   * Walks the DAG's referenced sub-DAG IRIs via `PluginDiscovery.walk()`,
   * maps each IRI to a module specifier via `resolveSpecifier`, dynamically
   * imports each via `PluginLoader.load()`, validates the default export as a
   * `PluginInterface`, and calls `dispatcher.registerPlugin(plugin)` for each.
   *
   * The entry DAG IRI itself is included in the walk result (at index 0). Pass
   * a `resolveSpecifier` that returns `undefined` (or an empty string) for IRIs
   * that do not map to an npm package to skip them, or filter the walk result
   * upstream before calling `loadAll`.
   *
   * @param dag              - Entry DAG to walk.
   * @param registry         - Known DAG registry keyed by expanded DAG IRI.
   * @param dispatcher       - The dispatcher to register plugins on.
   * @param resolveSpecifier - Maps a DAG IRI to an import() specifier.
   */
  static async loadAll(
    dag: DAGType,
    registry: ReadonlyMap<string, DAGType>,
    dispatcher: { registerPlugin(plugin: PluginInterface): void },
    resolveSpecifier: (dagIri: string) => string | undefined,
  ): Promise<void> {
    const dagIris = PluginDiscovery.walk(dag, registry);
    for (const dagIri of dagIris) {
      const specifier = resolveSpecifier(dagIri);
      if (specifier === undefined || specifier.length === 0) continue;
      const plugin = await PluginLoader.load(specifier);
      dispatcher.registerPlugin(plugin);
    }
  }
}
