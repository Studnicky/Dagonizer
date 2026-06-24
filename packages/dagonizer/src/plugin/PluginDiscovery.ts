/**
 * PluginDiscovery: static DAG-walker for finding literal dag-body references.
 *
 * Consumers use this utility to discover which plugin DAGs a given entry DAG
 * transitively depends on, so they can register the right plugins before
 * executing.
 *
 * Only literal `dag` body references are collected — `dagFrom` bodies use
 * runtime resolution (the name is read from state at execution time) and
 * cannot be statically discovered.
 */

import type { PluginInterface } from '../contracts/PluginInterface.js';
import type { DAGType } from '../entities/dag/DAG.js';

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
   * Collect all literal dag-body names referenced in the DAG's placement graph.
   *
   * Inspects every placement in `dag.nodes` and collects:
   * - `EmbeddedDAGNode.dag` (build-time literal sub-DAG name)
   * - `ScatterNode.body.dag` (scatter dag-body literal name)
   *
   * Skips `dagFrom` (resolved at runtime from state) and `node` bodies.
   * Returns a deduplicated, stable-ordered array of dag names.
   */
  static referencedDagNames(dag: DAGType): readonly string[] {
    const seen = new Set<string>();
    for (const placement of dag.nodes) {
      const type = placement['@type'];
      if (type === 'EmbeddedDAGNode') {
        // EmbeddedDAGNode: literal `dag` field (dagFrom is runtime, skip)
        const p = placement as { dag?: string };
        if (p.dag !== undefined && p.dag.length > 0) {
          seen.add(p.dag);
        }
      } else if (type === 'ScatterNode') {
        // ScatterNode: body may be { dag: string }
        const p = placement as { body: { dag?: string; dagFrom?: string; node?: string } };
        const body = p.body;
        if ('dag' in body && typeof body.dag === 'string' && body.dag.length > 0) {
          seen.add(body.dag);
        }
      }
    }
    return [...seen];
  }

  /**
   * Walk a DAG forest breadth-first: entry DAG + all reachable sub-DAGs
   * referenced by literal `dag` fields.
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
    resolveSpecifier: (dagName: string) => string,
  ): Promise<void> {
    const names = PluginDiscovery.walk(dag, registry);
    for (const name of names) {
      const specifier = resolveSpecifier(name);
      const plugin = await PluginLoader.load(specifier);
      dispatcher.registerPlugin(plugin);
    }
  }
}
