/**
 * FlowDeriver — derive a `DAG` from a registry of `OperationContract`s
 * by matching `produces ↔ hardRequired`.
 *
 * An edge `A → B` exists iff some path in `A.produces` appears in
 * `B.hardRequired`. The dispatcher executes operations in topological
 * order; operations sharing a depth (no remaining unsatisfied
 * prerequisites) are wrapped in a `parallel` placement.
 *
 * Two pieces of routing the data graph cannot express:
 *
 *   - alternate exits — operations whose non-success outcomes terminate
 *     the flow; declared via `annotations.terminals`.
 *   - fan-out roots — operations dispatched once per item from a
 *     state-array source; declared via `annotations.fanouts`.
 *
 * Static class. Adding a new operation is one registration; the flow
 * topology updates automatically.
 *
 * @example
 * ```ts
 * const dag = FlowDeriver.derive({
 *   name: 'pipeline',
 *   version: '1.0',
 *   entrypoint: 'classify',
 *   contracts: [
 *     { name: 'classify',  hardRequired: ['input'],     produces: ['classification'] },
 *     { name: 'enrich',    hardRequired: ['classification'], produces: ['enriched'] },
 *     { name: 'finalize',  hardRequired: ['enriched'],  produces: ['result'] },
 *   ],
 * });
 * dispatcher.registerDAG(dag);
 * ```
 */

import type { OperationContract } from '../contracts/OperationContract.js';
import type { DAG } from '../entities/dag/DAG.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/DAGError.js';

import type { FlowAnnotations } from './FlowAnnotations.js';

type DAGNodeEntry = FanOutNode | ParallelNode | SingleNodePlacementInterface;

export interface FlowDeriverOptions {
  readonly name: string;
  readonly version: string;
  readonly entrypoint: string;
  readonly contracts: readonly OperationContract[];
  readonly annotations?: FlowAnnotations;
}

export class FlowDeriver {
  private constructor() { /* static class */ }

  /**
   * Build a `DAG` from a contract registry plus declared annotations.
   * Operations named as a fan-out's `fanInOperation` are emitted as
   * registered single-node placements alongside the fan-out so the
   * `custom` fan-in strategy can resolve them.
   */
  static derive(opts: FlowDeriverOptions): DAG {
    const annotations = opts.annotations ?? {};
    const contracts = opts.contracts;
    if (contracts.length === 0) {
      throw new DAGError('FlowDeriver.derive requires at least one OperationContract');
    }

    const fanInOps = new Set<string>();
    for (const fan of Object.values(annotations.fanouts ?? {})) {
      fanInOps.add(fan.fanInOperation);
    }

    const eligibleContracts = contracts.filter((contract) => !fanInOps.has(contract.name));
    const edges = FlowDeriver.edges(eligibleContracts);
    const buckets = FlowDeriver.depthBuckets(eligibleContracts, edges);
    const nodes = FlowDeriver.renderNodes(buckets, edges, annotations);

    return {
      'name': opts.name,
      'version': opts.version,
      'entrypoint': opts.entrypoint,
      nodes,
    };
  }

  /**
   * Adjacency list of operations keyed by name. An entry `A → B` exists
   * iff some `path` in `A.produces` appears in `B.hardRequired`.
   */
  static edges(
    contracts: readonly OperationContract[],
  ): ReadonlyMap<string, ReadonlySet<string>> {
    const out = new Map<string, Set<string>>();
    for (const contract of contracts) {
      out.set(contract.name, new Set());
    }
    for (const upstream of contracts) {
      const produced = new Set(upstream.produces);
      for (const downstream of contracts) {
        if (downstream.name === upstream.name) continue;
        for (const required of downstream.hardRequired) {
          if (produced.has(required)) {
            out.get(upstream.name)?.add(downstream.name);
            break;
          }
        }
      }
    }
    return out;
  }

  /**
   * Topological sort by depth: every operation appears at the depth equal
   * to the longest path from a root. Operations sharing a depth become a
   * single bucket and are wrapped in a `parallel` placement.
   */
  static depthBuckets(
    contracts: readonly OperationContract[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
  ): readonly (readonly string[])[] {
    const indeg = new Map<string, number>();
    for (const contract of contracts) indeg.set(contract.name, 0);
    for (const [, succs] of edges) {
      for (const succ of succs) indeg.set(succ, (indeg.get(succ) ?? 0) + 1);
    }

    const depth = new Map<string, number>();
    const queue: string[] = [];
    for (const [name, value] of indeg) {
      if (value === 0) {
        depth.set(name, 0);
        queue.push(name);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      const cursorDepth = depth.get(cur) ?? 0;
      for (const next of edges.get(cur) ?? []) {
        const nextDepth = Math.max(depth.get(next) ?? 0, cursorDepth + 1);
        depth.set(next, nextDepth);
        indeg.set(next, (indeg.get(next) ?? 1) - 1);
        if ((indeg.get(next) ?? 0) === 0) queue.push(next);
      }
    }

    const buckets: string[][] = [];
    for (const [name, value] of depth) {
      while (buckets.length <= value) buckets.push([]);
      const bucket = buckets[value];
      if (bucket !== undefined) bucket.push(name);
    }
    return buckets;
  }

  private static stageOutputsFor(
    name: string,
    successors: ReadonlySet<string>,
    annotations: FlowAnnotations,
  ): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    const terminals = annotations.terminals?.[name];
    if (terminals !== undefined) {
      for (const terminal of terminals) out[terminal.outcome] = terminal.target;
    }
    const succList = [...successors];
    if (succList.length >= 1) {
      out['success'] = succList[0] ?? null;
    } else if (terminals === undefined) {
      out['success'] = null;
    }
    return out;
  }

  private static renderNodes(
    buckets: readonly (readonly string[])[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
    annotations: FlowAnnotations,
  ): DAGNodeEntry[] {
    const nodes: DAGNodeEntry[] = [];

    buckets.forEach((bucket, depth) => {
      const next = buckets[depth + 1] ?? [];
      if (bucket.length > 1) {
        const join = next[0] ?? null;
        const parallelNode: ParallelNode = {
          'type': 'parallel',
          'name': `depth_${depth.toString()}`,
          'nodes': [...bucket],
          'combine': 'collect',
          'outputs': {
            'success': join,
            'error': join,
          },
        };
        nodes.push(parallelNode);
      }
      for (const name of bucket) {
        const fan = annotations.fanouts?.[name];
        const succs = edges.get(name) ?? new Set<string>();
        if (fan !== undefined) {
          const fanOutOutputs: Record<string, string | null> = {};
          const next0 = [...succs][0] ?? null;
          for (const outcome of fan.outcomes) {
            fanOutOutputs[outcome] = next0;
          }
          const fanOutNode: FanOutNode = {
            'type': 'fan-out',
            name,
            'node': name,
            'source': fan.source,
            'itemKey': fan.itemKey,
            'fanIn': { 'strategy': 'custom', 'customNode': fan.fanInOperation },
            'outputs': fanOutOutputs,
          };
          if (fan.concurrency !== undefined) fanOutNode.concurrency = fan.concurrency;
          nodes.push(fanOutNode);
        } else {
          const single: SingleNodePlacementInterface = {
            'type': 'single',
            name,
            'node': name,
            'outputs': FlowDeriver.stageOutputsFor(name, succs, annotations),
          };
          nodes.push(single);
        }
      }
    });
    return nodes;
  }
}
