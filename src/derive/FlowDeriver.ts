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
 *     { name: 'classify', hardRequired: ['input'],          produces: ['classification'], outputs: ['success'] },
 *     { name: 'enrich',   hardRequired: ['classification'], produces: ['enriched'],       outputs: ['success', 'cached', 'skipped'] },
 *     { name: 'finalize', hardRequired: ['enriched'],       produces: ['result'],         outputs: ['success', 'error'] },
 *   ],
 * });
 * dispatcher.registerDAG(dag);
 * ```
 */

import type { OperationContract } from '../contracts/OperationContract.js';
import type { DAG } from '../entities/dag/DAG.js';
import { DAG_CONTEXT } from '../entities/dag/DAG.js';
import type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/DAGError.js';

import type { FlowAnnotations } from './FlowAnnotations.js';

type DAGNodeEntry = DeepDAGNode | FanOutNode | ParallelNode | SingleNodePlacementInterface;

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
   *
   * The returned document is a canonical JSON-LD DAG with `@context`,
   * `@id`, and `@type` at the root; each placement carries `@id` and
   * `@type` as required by `DAGSchema`.
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
    const contractsByName = new Map<string, OperationContract>();
    for (const contract of eligibleContracts) contractsByName.set(contract.name, contract);

    const edges = FlowDeriver.edges(eligibleContracts);
    const buckets = FlowDeriver.depthBuckets(eligibleContracts, edges);
    const nodes = FlowDeriver.renderNodes(buckets, edges, contractsByName, annotations, opts.name);

    return {
      '@context': DAG_CONTEXT,
      '@id':      `urn:noocodex:dag:${opts.name}`,
      '@type':    'DAG',
      'name':       opts.name,
      'version':    opts.version,
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

  /**
   * Resolve the `outputs` map for a placement.
   *
   * Every port in `declaredOutputs` auto-wires to the first derived
   * successor (`null` if none). Terminal annotations override
   * individual ports; a terminal whose `outcome` doesn't appear in
   * `declaredOutputs` is a routing-shape mismatch and throws
   * `DAGError`. The same resolver runs for `SingleNode` (contract
   * outputs) and `DeepDAGNode` (subDAG outputs) so both placements
   * fail fast on out-of-band terminals with the same error shape.
   */
  private static resolveOutputs(
    name: string,
    declaredOutputs: readonly string[],
    sourceLabel: string,
    successors: ReadonlySet<string>,
    annotations: FlowAnnotations,
  ): Record<string, string | null> {
    const overrides = new Map<string, string | null>();
    const terminals = annotations.terminals?.[name] ?? [];
    const declared = new Set(declaredOutputs);

    for (const terminal of terminals) {
      if (!declared.has(terminal.outcome)) {
        throw new DAGError(
          `FlowDeriver: terminal for '${name}' references port '${terminal.outcome}' which is not in the ${sourceLabel} [${declaredOutputs.join(', ')}]`,
        );
      }
      overrides.set(terminal.outcome, terminal.target);
    }

    const defaultNext = [...successors][0] ?? null;
    const out: Record<string, string | null> = {};
    for (const port of declaredOutputs) {
      out[port] = overrides.has(port) ? overrides.get(port) ?? null : defaultNext;
    }
    return out;
  }

  private static renderNodes(
    buckets: readonly (readonly string[])[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
    contracts: ReadonlyMap<string, OperationContract>,
    annotations: FlowAnnotations,
    dagName: string,
  ): DAGNodeEntry[] {
    const nodes: DAGNodeEntry[] = [];
    const nodeId = (placementName: string): string =>
      `urn:noocodex:dag:${dagName}/node/${placementName}`;

    buckets.forEach((bucket, depth) => {
      const next = buckets[depth + 1] ?? [];
      if (bucket.length > 1) {
        const join = next[0] ?? null;
        const parallelName = `depth_${depth.toString()}`;
        const parallelNode: ParallelNode = {
          '@id':     nodeId(parallelName),
          '@type':   'ParallelNode',
          'name':    parallelName,
          'nodes':   [...bucket],
          'combine': 'collect',
          'outputs': {
            'success': join,
            'error':   join,
          },
        };
        nodes.push(parallelNode);
      }
      for (const name of bucket) {
        const fan = annotations.fanouts?.[name];
        const subDAG = annotations.subDAGs?.[name];
        const succs = edges.get(name) ?? new Set<string>();

        // Renderer dispatch order: fanouts > subDAGs > single. A contract
        // listed in both fanouts and subDAGs is a configuration error —
        // the placement-kind must be unambiguous.
        if (fan !== undefined && subDAG !== undefined) {
          throw new DAGError(
            `FlowDeriver: operation '${name}' appears in both annotations.fanouts and annotations.subDAGs — placement kind must be unambiguous`,
          );
        }

        if (fan !== undefined) {
          const fanOutOutputs: Record<string, string | null> = {};
          const next0 = [...succs][0] ?? null;
          for (const outcome of fan.outcomes) {
            fanOutOutputs[outcome] = next0;
          }
          const fanOutNode: FanOutNode = {
            '@id':    nodeId(name),
            '@type':  'FanOutNode',
            name,
            'node':   name,
            'source': fan.source,
            'itemKey': fan.itemKey,
            'fanIn': { 'strategy': 'custom', 'customNode': fan.fanInOperation },
            'outputs': fanOutOutputs,
          };
          if (fan.concurrency !== undefined) fanOutNode.concurrency = fan.concurrency;
          nodes.push(fanOutNode);
        } else if (subDAG !== undefined) {
          const deepDAGNode: DeepDAGNode = {
            '@id':   nodeId(name),
            '@type': 'DeepDAGNode',
            name,
            'dag':   subDAG.dag,
            'outputs': FlowDeriver.resolveOutputs(
              name,
              subDAG.outputs,
              `subDAG '${subDAG.dag}' declared outputs`,
              succs,
              annotations,
            ),
          };
          if (subDAG.stateMapping !== undefined) {
            deepDAGNode.stateMapping = subDAG.stateMapping;
          }
          nodes.push(deepDAGNode);
        } else {
          const contract = contracts.get(name);
          if (contract === undefined) {
            throw new DAGError(`FlowDeriver: contract for '${name}' not found in registry`);
          }
          const single: SingleNodePlacementInterface = {
            '@id':   nodeId(name),
            '@type': 'SingleNode',
            name,
            'node': name,
            'outputs': FlowDeriver.resolveOutputs(
              name,
              contract.outputs,
              `contract's outputs`,
              succs,
              annotations,
            ),
          };
          nodes.push(single);
        }
      }
    });
    return nodes;
  }
}
