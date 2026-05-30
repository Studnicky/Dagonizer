/**
 * ContractRegistryValidator — static class for registration-time validation
 * of co-located node contracts.
 *
 * Surfaces two categories of drift:
 *
 *   - **Dangling-read**: a non-entrypoint node declares `hardRequired: ['foo.bar']`
 *     but no upstream-in-DAG node produces `'foo.bar'`. Thrown as a `DAGError`.
 *     The entrypoint node's `hardRequired` are external initial-state fields and
 *     are not validated (they are seeded before execution starts).
 *   - **Dead-write**: a node declares `produces: ['baz']` but no downstream-in-DAG
 *     node `hardRequires` `'baz'`. Emitted as a non-fatal warning via the supplied
 *     `onWarning` callback.
 *
 * Validation walks the full contract set via the same edge semantics
 * (`produces ↔ hardRequired`) that `DAGDeriver` uses to build topology, so the
 * check respects placement boundaries.
 */

import type { OperationContract } from '../contracts/OperationContract.js';
import { DAGError } from '../errors/DAGError.js';

export class ContractRegistryValidator {
  private constructor() { /* static class */ }

  /**
   * Build the adjacency set (name → set of names it can reach) using the same
   * `produces ↔ hardRequired` edge rule as `DAGDeriver.edges`.
   */
  private static buildUpstreamProducers(
    contracts: readonly OperationContract[],
  ): Map<string, Set<string>> {
    // upstreamProducers[B] = set of all field paths produced by any ancestor of B.
    // We compute this via transitive closure over the direct-edge graph.
    const directEdges = new Map<string, Set<string>>();
    for (const c of contracts) directEdges.set(c.name, new Set());

    for (const upstream of contracts) {
      const produced = new Set(upstream.produces);
      for (const downstream of contracts) {
        if (downstream.name === upstream.name) continue;
        for (const req of downstream.hardRequired) {
          if (produced.has(req)) {
            directEdges.get(upstream.name)?.add(downstream.name);
            break;
          }
        }
      }
    }

    // For each node, collect the union of all produces from its ancestors
    // (nodes that can reach it via topological paths).
    const upstreamProducers = new Map<string, Set<string>>();
    for (const target of contracts) {
      const reachable = new Set<string>();
      const queue: string[] = [];
      // Find all nodes that have an edge TO target (reverse BFS).
      for (const [src, succs] of directEdges) {
        if (succs.has(target.name)) queue.push(src);
      }
      const visited = new Set<string>();
      while (queue.length > 0) {
        const cur = queue.shift();
        if (cur === undefined) break;
        if (visited.has(cur)) continue;
        visited.add(cur);
        // Collect produces from cur
        const curContract = contracts.find((c) => c.name === cur);
        if (curContract) {
          for (const p of curContract.produces) reachable.add(p);
        }
        // Walk further upstream
        for (const [src, succs] of directEdges) {
          if (succs.has(cur) && !visited.has(src)) queue.push(src);
        }
      }
      upstreamProducers.set(target.name, reachable);
    }

    return upstreamProducers;
  }

  /**
   * Validate a contract set for dangling reads and dead writes.
   *
   * @param contracts - The full set of contracts derived from the node registry.
   * @param onWarning - Called for each dead-write warning (non-fatal).
   * @param entrypointName - Optional entrypoint operation name. When supplied, that
   *   node's `hardRequired` paths are treated as external initial-state fields and
   *   are not checked for dangling reads.
   *
   * @throws {DAGError} When any non-entrypoint node declares a `hardRequired` path
   *   that no upstream-in-DAG node produces.
   */
  static validate(
    contracts: readonly OperationContract[],
    onWarning: (message: string) => void,
    entrypointName?: string,
  ): void {
    const upstreamProducers = ContractRegistryValidator.buildUpstreamProducers(contracts);

    // The entrypoint's hardRequired paths are the flow's external initial
    // state — ambient and present from the start, so ANY node may read them
    // without an upstream producer (not just the entrypoint itself).
    const externalKeys = new Set<string>(
      entrypointName === undefined
        ? []
        : contracts.find((c) => c.name === entrypointName)?.hardRequired ?? [],
    );

    // Dangling-read: hardRequired path neither external nor produced upstream.
    for (const contract of contracts) {
      if (contract.name === entrypointName) continue;
      const upstream = upstreamProducers.get(contract.name) ?? new Set();
      for (const path of contract.hardRequired) {
        if (externalKeys.has(path)) continue;
        if (!upstream.has(path)) {
          throw new DAGError(
            `ContractRegistryValidator: node '${contract.name}' hardRequires '${path}' but no upstream-in-DAG node produces it`,
          );
        }
      }
    }

    // Dead-write: produces path not required by any node downstream.
    // Build a set of all hardRequired paths across all contracts.
    const allRequired = new Set<string>();
    for (const contract of contracts) {
      for (const path of contract.hardRequired) {
        allRequired.add(path);
      }
    }

    for (const contract of contracts) {
      for (const path of contract.produces) {
        if (!allRequired.has(path)) {
          onWarning(
            `ContractRegistryValidator: node '${contract.name}' produces '${path}' but no node in the registry hardRequires it`,
          );
        }
      }
    }
  }
}
