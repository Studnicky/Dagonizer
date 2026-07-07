/**
 * PluginDiscovery: static DAG-walker for finding declared DAG references.
 *
 * Consumers use this utility to discover which plugin DAGs a given entry DAG
 * transitively depends on, so they can register the right plugins before
 * executing.
 *
 * Literal references contribute one DAG name; dynamic `DagReference` values
 * contribute their declared candidate DAG names.
 */

import type { PluginInterface } from '../contracts/PluginInterface.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagReference } from '../entities/dag/DagReference.js';

import { PluginLoader } from './PluginLoader.js';

/**
 * Static DAG-walker for discovering literal sub-DAG references in a DAG
 * document's placement graph.
 *
 * Each method is a pure function over immutable inputs; no side effects.
 */
export class PluginDiscovery {
  private constructor() { /* static-only */ }

  /**
   * Collect all declared dag-body names referenced in the DAG's placement graph.
   *
   * Inspects every placement in `dag.nodes` and collects:
   * - `EmbeddedDAGNode.dag` literal or dynamic candidate names
   * - `ScatterNode.body.dag` literal or dynamic candidate names
   *
   * Skips `node` bodies because they reference registered nodes, not DAGs.
   * Returns a deduplicated, stable-ordered array of dag names.
   */
  static referencedDagNames(dag: DAGType): readonly string[] {
    const seen = new Set<string>();
    for (const placement of dag.nodes) {
      const type = placement['@type'];
      if (type === 'EmbeddedDAGNode') {
        if (placement.dag !== undefined) {
          for (const candidate of DagReference.candidates(placement.dag)) {
            seen.add(candidate);
          }
        }
      } else if (type === 'ScatterNode') {
        if ('dag' in placement.body) {
          for (const candidate of DagReference.candidates(placement.body.dag)) {
            seen.add(candidate);
          }
        }
      }
    }
    return [...seen];
  }

  /**
   * Walk a DAG forest breadth-first: entry DAG + all reachable sub-DAGs
   * referenced by literal or dynamic candidate `dag` fields.
   *
   * Returns the ordered list of all DAG names reachable from `dag` (including
   * `dag.name` itself at index 0). DAGs absent from `registry` are skipped
   * silently — the caller is responsible for ensuring the registry is populated
   * before execution.
   *
   * Cycle-safe: each name is visited at most once.
   */
  static walk(dag: DAGType, registry: ReadonlyMap<string, DAGType>): readonly string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const queue: DAGType[] = [dag];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const name = current.name;
      if (visited.has(name)) continue;
      visited.add(name);
      result.push(name);

      for (const refName of PluginDiscovery.referencedDagNames(current)) {
        if (!visited.has(refName)) {
          const refDag = registry.get(refName);
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
   * Walks the DAG's referenced sub-DAG names via `PluginDiscovery.walk()`,
   * maps each name to a module specifier via `resolveSpecifier`, dynamically
   * imports each via `PluginLoader.load()`, validates the default export as a
   * `PluginInterface`, and calls `dispatcher.registerPlugin(plugin)` for each.
   *
   * The entry DAG name itself is included in the walk result (at index 0). Pass
   * a `resolveSpecifier` that returns `undefined` (or an empty string) for names
   * that do not map to an npm package to skip them, or filter the walk result
   * upstream before calling `loadAll`.
   *
   * @param dag              - Entry DAG to walk.
   * @param registry         - Known DAG registry for the walk.
   * @param dispatcher       - The dispatcher to register plugins on.
   * @param resolveSpecifier - Maps a dag name to an import() specifier.
   */
  static async loadAll(
    dag: DAGType,
    registry: ReadonlyMap<string, DAGType>,
    dispatcher: { registerPlugin(plugin: PluginInterface): void },
    resolveSpecifier: (dagName: string) => string | undefined,
  ): Promise<void> {
    const names = PluginDiscovery.walk(dag, registry);
    for (const name of names) {
      const specifier = resolveSpecifier(name);
      if (specifier === undefined || specifier.length === 0) continue;
      const plugin = await PluginLoader.load(specifier);
      dispatcher.registerPlugin(plugin);
    }
  }
}
