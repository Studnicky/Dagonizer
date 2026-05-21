/**
 * DAGDeriver — derive a `DAG` from a registry of `OperationContract`s
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
 * const dag = DAGDeriver.derive({
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

import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { OperationContract } from '../contracts/OperationContract.js';
import type { DAG } from '../entities/dag/DAG.js';
import { DAG_CONTEXT } from '../entities/dag/DAG.js';
import type { DeepDAGNode } from '../entities/dag/DeepDAGNode.js';
import type { FanOutNode } from '../entities/dag/FanOutNode.js';
import type { ParallelNode } from '../entities/dag/ParallelNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/DAGError.js';

import { ContractRegistryValidator } from './ContractRegistryValidator.js';
import type {
  DAGDeriverAnnotations,
  DAGDeriverFanOut,
  DAGDeriverSubDAG,
} from './DAGDeriverAnnotations.js';

type DAGNodeEntry = DeepDAGNode | FanOutNode | ParallelNode | SingleNodePlacementInterface;

export interface DAGDeriverOptions {
  readonly name: string;
  readonly version: string;
  readonly entrypoint: string;
  /**
   * Standalone contracts (legacy path). Mutually exclusive with `nodes`.
   */
  readonly contracts?: readonly OperationContract[];
  /**
   * Node registry — every node with a `contract` field participates in
   * topology derivation. Nodes without a contract are silently skipped
   * (the dispatcher still registers them, they just don't participate
   * in derived edges).
   */
  readonly nodes?: readonly NodeInterface[];
  readonly annotations?: DAGDeriverAnnotations;
}

export class DAGDeriver {
  private constructor() { /* static class */ }

  /**
   * Project contract-bearing nodes from a node registry into `OperationContract`s.
   * Nodes without a `contract` field are silently skipped.
   *
   * The node's own `name` and `outputs` fields complete the full
   * `OperationContract` surface alongside the fragment's `hardRequired`
   * and `produces`.
   */
  static extractContracts(nodes: readonly NodeInterface[]): OperationContract[] {
    const result: OperationContract[] = [];
    for (const node of nodes) {
      if (node.contract !== undefined) {
        result.push({
          "name": node.name,
          "outputs": node.outputs,
          "hardRequired": node.contract.hardRequired,
          "produces": node.contract.produces,
        });
      }
    }
    return result;
  }

  /**
   * Build a `DAG` from a contract registry plus declared annotations.
   * Operations named as a fan-out's `fanInOperation` are emitted as
   * registered single-node placements alongside the fan-out so the
   * `custom` fan-in strategy can resolve them.
   *
   * The returned document is a canonical JSON-LD DAG with `@context`,
   * `@id`, and `@type` at the root; each placement carries `@id` and
   * `@type` as required by `DAGSchema`.
   *
   * Accepts either `contracts` (standalone, legacy) or `nodes` (co-located
   * contract on each node). The two options are mutually exclusive — supply
   * exactly one.
   */
  static derive(opts: DAGDeriverOptions): DAG {
    const annotations = opts.annotations ?? {};

    const hasContracts = opts.contracts !== undefined;
    const hasNodes = opts.nodes !== undefined;

    if (hasContracts && hasNodes) {
      throw new DAGError(
        'DAGDeriver.derive: supply either `contracts` or `nodes`, not both',
      );
    }

    let contracts: readonly OperationContract[];

    if (hasNodes) {
      const extracted = DAGDeriver.extractContracts(opts.nodes ?? []);
      if (extracted.length === 0) {
        throw new DAGError(
          'DAGDeriver.derive: no node in the registry carries a `contract` field — at least one node must declare a contract for topology derivation',
        );
      }
      // Preflight: same dangling-read / dead-write checks the validator runs
      // at registration time — surface drift before the DAG is even built.
      // Pass entrypoint so the entrypoint's hardRequired (external initial state)
      // are not flagged as dangling reads.
      ContractRegistryValidator.validate(extracted, (_msg) => { /* warnings surfaced at registerDAG time */ }, opts.entrypoint);
      contracts = extracted;
    } else if (hasContracts) {
      contracts = opts.contracts ?? [];
    } else {
      throw new DAGError(
        'DAGDeriver.derive: supply either `contracts` or `nodes`',
      );
    }

    if (contracts.length === 0) {
      throw new DAGError('DAGDeriver.derive requires at least one OperationContract');
    }

    // Operations referenced only as a fan-in step (the `customNode`
    // for a 'custom' strategy fan-out) are emitted alongside the
    // fan-out placement but excluded from topology derivation —
    // they're called by the dispatcher's fan-out reducer, not by a
    // graph edge.
    const fanInOps = new Set<string>();
    for (const fan of Object.values(annotations.fanouts ?? {})) {
      if (fan.strategy === 'custom') fanInOps.add(fan.fanInOperation);
    }

    DAGDeriver.validateAnnotations(annotations, contracts);

    const eligibleContracts = contracts.filter((contract) => !fanInOps.has(contract.name));
    const contractsByName = new Map<string, OperationContract>();
    for (const contract of eligibleContracts) contractsByName.set(contract.name, contract);

    const edges = DAGDeriver.edges(eligibleContracts);
    const buckets = DAGDeriver.depthBuckets(eligibleContracts, edges);
    const nodes = DAGDeriver.renderNodes(buckets, edges, contractsByName, annotations, opts.name);

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
   * Defensive runtime checks on the annotation shape. TypeScript's
   * discriminated unions catch most invalid combinations at compile
   * time; these checks backstop the same invariants for callers that
   * pass annotations through `unknown` boundaries (config files,
   * loaded JSON, etc.).
   */
  private static validateAnnotations(
    annotations: DAGDeriverAnnotations,
    contracts: readonly OperationContract[],
  ): void {
    const contractNames = new Set(contracts.map((c) => c.name));

    // fanouts: validate strategy-specific fields and that referenced ops exist
    for (const [opName, fan] of Object.entries(annotations.fanouts ?? {})) {
      if (!contractNames.has(opName)) {
        throw new DAGError(
          `DAGDeriver: annotations.fanouts['${opName}'] references an operation not in the contract registry`,
        );
      }
      if (fan.strategy === 'partition') {
        for (const outcome of Object.keys(fan.partitions)) {
          if (!fan.outcomes.includes(outcome)) {
            throw new DAGError(
              `DAGDeriver: fanouts['${opName}'].partitions['${outcome}'] is not listed in outcomes [${fan.outcomes.join(', ')}]`,
            );
          }
        }
      }
      if (fan.strategy === 'custom' && !contractNames.has(fan.fanInOperation)) {
        throw new DAGError(
          `DAGDeriver: fanouts['${opName}'].fanInOperation '${fan.fanInOperation}' is not in the contract registry`,
        );
      }
    }

    // parallels: members must be contracts, no overlapping membership,
    // can't collide with fanouts or subDAGs.
    const parallelMembership = new Map<string, string>();   // memberName → parallel groupName
    for (const [groupName, group] of Object.entries(annotations.parallels ?? {})) {
      if (group.members.length === 0) {
        throw new DAGError(
          `DAGDeriver: parallels['${groupName}'] declares zero members; a parallel group requires at least one operation`,
        );
      }
      for (const member of group.members) {
        if (!contractNames.has(member)) {
          throw new DAGError(
            `DAGDeriver: parallels['${groupName}'].members contains '${member}' which is not in the contract registry`,
          );
        }
        const existingGroup = parallelMembership.get(member);
        if (existingGroup !== undefined) {
          throw new DAGError(
            `DAGDeriver: operation '${member}' appears in multiple parallels (${existingGroup}, ${groupName}); membership must be exclusive`,
          );
        }
        parallelMembership.set(member, groupName);
        if (annotations.fanouts?.[member] !== undefined) {
          throw new DAGError(
            `DAGDeriver: operation '${member}' appears in both annotations.parallels['${groupName}'] and annotations.fanouts — placement kind must be unambiguous`,
          );
        }
        if (annotations.subDAGs?.[member] !== undefined) {
          throw new DAGError(
            `DAGDeriver: operation '${member}' appears in both annotations.parallels['${groupName}'] and annotations.subDAGs — placement kind must be unambiguous`,
          );
        }
      }
    }
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
    annotations: DAGDeriverAnnotations,
  ): Record<string, string | null> {
    const overrides = new Map<string, string | null>();
    const terminals = annotations.terminals?.[name] ?? [];
    const declared = new Set(declaredOutputs);

    for (const terminal of terminals) {
      if (!declared.has(terminal.outcome)) {
        throw new DAGError(
          `DAGDeriver: terminal for '${name}' references port '${terminal.outcome}' which is not in the ${sourceLabel} [${declaredOutputs.join(', ')}]`,
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
    annotations: DAGDeriverAnnotations,
    dagName: string,
  ): DAGNodeEntry[] {
    const nodes: DAGNodeEntry[] = [];
    const nodeId = (placementName: string): string =>
      `urn:noocodex:dag:${dagName}/node/${placementName}`;

    // Member → group lookup so we render explicit parallels exactly once
    // (when the first member is encountered in topological order).
    const memberToParallel = new Map<string, string>();
    for (const [groupName, group] of Object.entries(annotations.parallels ?? {})) {
      for (const member of group.members) memberToParallel.set(member, groupName);
    }
    const renderedParallels = new Set<string>();

    buckets.forEach((bucket, depth) => {
      const next = buckets[depth + 1] ?? [];

      // Explicit `parallels` annotation takes precedence over auto-grouping:
      // when a member is at the current depth and its parallel group hasn't
      // been rendered yet, emit the ParallelNode with the consumer's
      // chosen combine strategy.
      for (const name of bucket) {
        const groupName = memberToParallel.get(name);
        if (groupName === undefined || renderedParallels.has(groupName)) continue;
        const group = annotations.parallels?.[groupName];
        if (group === undefined) continue;
        const join = next[0] ?? null;
        const parallelNode: ParallelNode = {
          '@id':     nodeId(groupName),
          '@type':   'ParallelNode',
          'name':    groupName,
          'nodes':   [...group.members],
          'combine': group.combine,
          'outputs': {
            'success': join,
            'error':   join,
          },
        };
        nodes.push(parallelNode);
        renderedParallels.add(groupName);
      }

      // Auto-parallel on same-depth ONLY for members not already covered by
      // an explicit `parallels` group. Auto-grouping uses combine: 'collect'.
      const autoBucket = bucket.filter((name) => memberToParallel.get(name) === undefined);
      if (autoBucket.length > 1) {
        const join = next[0] ?? null;
        const parallelName = `depth_${depth.toString()}`;
        const parallelNode: ParallelNode = {
          '@id':     nodeId(parallelName),
          '@type':   'ParallelNode',
          'name':    parallelName,
          'nodes':   [...autoBucket],
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

        // Mutual exclusion across the placement-shape annotations.
        // (parallels collisions are checked in validateAnnotations.)
        if (fan !== undefined && subDAG !== undefined) {
          throw new DAGError(
            `DAGDeriver: operation '${name}' appears in both annotations.fanouts and annotations.subDAGs — placement kind must be unambiguous`,
          );
        }

        if (fan !== undefined) {
          nodes.push(DAGDeriver.renderFanOutNode(name, fan, succs, annotations, nodeId));
        } else if (subDAG !== undefined) {
          nodes.push(DAGDeriver.renderDeepDAGNode(name, subDAG, succs, annotations, nodeId));
        } else {
          const contract = contracts.get(name);
          if (contract === undefined) {
            throw new DAGError(`DAGDeriver: contract for '${name}' not found in registry`);
          }
          const single: SingleNodePlacementInterface = {
            '@id':   nodeId(name),
            '@type': 'SingleNode',
            name,
            'node': name,
            'outputs': DAGDeriver.resolveOutputs(
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

  /**
   * Render a `FanOutNode` placement from a `DAGDeriverFanOut`
   * annotation. The fan-in `strategy` discriminates which engine-side
   * `FanInConfig` shape gets emitted.
   */
  private static renderFanOutNode(
    name: string,
    fan: DAGDeriverFanOut,
    successors: ReadonlySet<string>,
    annotations: DAGDeriverAnnotations,
    nodeId: (n: string) => string,
  ): FanOutNode {
    const next0 = [...successors][0] ?? null;
    const outcomeOverrides = new Map<string, string | null>();
    for (const terminal of annotations.terminals?.[name] ?? []) {
      if (!fan.outcomes.includes(terminal.outcome)) {
        throw new DAGError(
          `DAGDeriver: terminal for fan-out '${name}' references outcome '${terminal.outcome}' which is not in outcomes [${fan.outcomes.join(', ')}]`,
        );
      }
      outcomeOverrides.set(terminal.outcome, terminal.target);
    }
    const fanOutOutputs: Record<string, string | null> = {};
    for (const outcome of fan.outcomes) {
      fanOutOutputs[outcome] = outcomeOverrides.has(outcome)
        ? outcomeOverrides.get(outcome) ?? null
        : next0;
    }

    let fanIn: FanOutNode['fanIn'];
    if (fan.strategy === 'custom') {
      fanIn = { 'strategy': 'custom', 'customNode': fan.fanInOperation };
    } else if (fan.strategy === 'partition') {
      fanIn = { 'strategy': 'partition', 'partitions': { ...fan.partitions } };
    } else {
      fanIn = { 'strategy': 'append', 'target': fan.target };
    }

    const fanOutNode: FanOutNode = {
      '@id':     nodeId(name),
      '@type':   'FanOutNode',
      name,
      'node':    fan.node,
      'source':  fan.source,
      'itemKey': fan.itemKey,
      'fanIn':   fanIn,
      'outputs': fanOutOutputs,
    };
    if (fan.concurrency !== undefined) fanOutNode.concurrency = fan.concurrency;
    return fanOutNode;
  }

  /** Render a `DeepDAGNode` placement from a `DAGDeriverSubDAG` annotation. */
  private static renderDeepDAGNode(
    name: string,
    subDAG: DAGDeriverSubDAG,
    successors: ReadonlySet<string>,
    annotations: DAGDeriverAnnotations,
    nodeId: (n: string) => string,
  ): DeepDAGNode {
    const deepDAGNode: DeepDAGNode = {
      '@id':   nodeId(name),
      '@type': 'DeepDAGNode',
      name,
      'dag':   subDAG.dag,
      'outputs': DAGDeriver.resolveOutputs(
        name,
        subDAG.outputs,
        `subDAG '${subDAG.dag}' declared outputs`,
        successors,
        annotations,
      ),
    };
    if (subDAG.stateMapping !== undefined) {
      deepDAGNode.stateMapping = subDAG.stateMapping;
    }
    return deepDAGNode;
  }
}
