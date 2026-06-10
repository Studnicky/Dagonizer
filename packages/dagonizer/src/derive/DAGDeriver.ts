/**
 * DAGDeriver: derive a `DAG` from a registry of `OperationContract`s
 * by matching `produces ↔ hardRequired`.
 *
 * An edge `A → B` exists iff some path in `A.produces` appears in
 * `B.hardRequired`. The dispatcher executes operations in topological
 * order; operations sharing a depth (no remaining unsatisfied
 * prerequisites) are emitted as sequential `SingleNode` placements in
 * bucket order.
 *
 * Two pieces of routing the data graph cannot express:
 *
 *   - alternate exits: operations whose non-success outcomes terminate
 *     the flow; declared via `annotations.terminals`.
 *   - scatter roots: operations dispatched once per item from a
 *     state-array source; declared via `annotations.scatters`.
 *
 * Static class. Adding a new operation is one registration; the flow
 * topology updates automatically.
 *
 * @example
 * ```ts
 * // Each node co-locates its own `contract` ({ hardRequired, produces }).
 * const dag = DAGDeriver.derive({
 *   name: 'pipeline',
 *   version: '1.0',
 *   entrypoint: 'classify',
 *   nodes: [classifyNode, enrichNode, finalizeNode],
 * });
 * dispatcher.registerDAG(dag);
 * ```
 */

import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { OperationContract } from '../contracts/OperationContract.js';
import type { DAG } from '../entities/dag/DAG.js';
import { DAG_CONTEXT } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNode } from '../entities/dag/EmbeddedDAGNode.js';
import type { ScatterNode } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementInterface } from '../entities/dag/SingleNode.js';
import type { TerminalNodePlacementInterface } from '../entities/dag/TerminalNode.js';
import { DAGError } from '../errors/DAGError.js';
import { NoopWarningEmitter } from '../runtime/NoopWarningEmitter.js';

import { ContractRegistryValidator } from './ContractRegistryValidator.js';
import type {
  DAGDeriverAnnotations,
  DAGDeriverEmitTerminal,
  DAGDeriverScatter,
  DAGDeriverEmbeddedDAG,
} from './DAGDeriverAnnotations.js';

type DAGNodeEntry = EmbeddedDAGNode | ScatterNode | SingleNodePlacementInterface | TerminalNodePlacementInterface;

export interface DAGDeriverOptions {
  readonly name: string;
  readonly version: string;
  readonly entrypoint: string;
  /**
   * Node registry. Every node with a co-located `contract` field participates
   * in topology derivation; nodes without one still register but contribute no
   * derived edges. At least one node must declare a contract. Contracts are
   * single-source-of-truth on the node; there is no standalone contracts input.
   */
  readonly nodes: readonly NodeInterface[];
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
   * Operations named as a scatter's `customNode` are emitted as
   * registered single-node placements alongside the scatter so the
   * `custom` gather strategy can resolve them.
   *
   * The returned document is a canonical JSON-LD DAG with `@context`,
   * `@id`, and `@type` at the root; each placement carries `@id` and
   * `@type` as required by `DAGSchema`.
   *
   * Topology is derived from the contracts co-located on `opts.nodes`. At
   * least one node must declare a `contract`.
   */
  static derive(opts: DAGDeriverOptions): DAG {
    const annotations = opts.annotations ?? {};

    const contracts = DAGDeriver.extractContracts(opts.nodes);
    if (contracts.length === 0) {
      throw new DAGError(
        'DAGDeriver.derive: no node carries a `contract` field; at least one node must declare a contract for topology derivation',
      );
    }
    // Preflight: same dangling-read / dead-write checks the validator runs at
    // registration time: surface drift before the DAG is even built. Pass
    // entrypoint so the entrypoint's hardRequired (external initial state) are
    // not flagged as dangling reads.
    ContractRegistryValidator.validate(contracts, new NoopWarningEmitter(), { 'entrypointName': opts.entrypoint });

    // Operations referenced only as a gather step (the `customNode`
    // for a 'custom' strategy scatter) are emitted alongside the
    // scatter placement but excluded from topology derivation;
    // they're called by the dispatcher's gather reducer, not by a
    // graph edge.
    const gatherOps = new Set<string>();
    for (const scatter of Object.values(annotations.scatters ?? {})) {
      if (scatter.strategy === 'custom') gatherOps.add(scatter.customNode);
    }

    DAGDeriver.validateAnnotations(annotations, contracts);

    const eligibleContracts = contracts.filter((contract) => !gatherOps.has(contract.name));
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

    // scatters: validate strategy-specific fields and that referenced ops exist
    for (const [opName, scatter] of Object.entries(annotations.scatters ?? {})) {
      if (!contractNames.has(opName)) {
        throw new DAGError(
          `DAGDeriver: annotations.scatters['${opName}'] references an operation not in the contract registry`,
        );
      }
      if (scatter.strategy === 'partition') {
        for (const outcome of Object.keys(scatter.partitions)) {
          if (!scatter.outcomes.includes(outcome)) {
            throw new DAGError(
              `DAGDeriver: scatters['${opName}'].partitions['${outcome}'] is not listed in outcomes [${scatter.outcomes.join(', ')}]`,
            );
          }
        }
      }
      if (scatter.strategy === 'custom' && !contractNames.has(scatter.customNode)) {
        throw new DAGError(
          `DAGDeriver: scatters['${opName}'].customNode '${scatter.customNode}' is not in the contract registry`,
        );
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
   * single bucket, emitted as sequential `SingleNode` placements in
   * bucket order.
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
   * outputs) and `EmbeddedDAGNode` (embeddedDAG outputs) so both placements
   * fail fast on out-of-band terminals with the same error shape.
   */
  private static resolveOutputs(
    name: string,
    declaredOutputs: readonly string[],
    sourceLabel: string,
    successors: ReadonlySet<string>,
    annotations: DAGDeriverAnnotations,
    emitCollector: Map<string, DAGDeriverEmitTerminal>,
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
      if ('emit' in terminal) {
        DAGDeriver.collectEmit(terminal.emit, emitCollector);
        overrides.set(terminal.outcome, terminal.emit.name);
      } else {
        overrides.set(terminal.outcome, terminal.target);
      }
    }

    const defaultNext = [...successors][0] ?? null;
    const out: Record<string, string | null> = {};
    for (const port of declaredOutputs) {
      out[port] = overrides.has(port) ? overrides.get(port) ?? null : defaultNext;
    }
    return out;
  }

  /**
   * Accumulate an `emit` annotation into the collector map. Deduplicates by
   * name; throws `DAGError` when two `emit` entries share a name but disagree
   * on `outcome`.
   */
  private static collectEmit(
    emit: DAGDeriverEmitTerminal,
    collector: Map<string, DAGDeriverEmitTerminal>,
  ): void {
    const existing = collector.get(emit.name);
    if (existing === undefined) {
      collector.set(emit.name, emit);
      return;
    }
    if (existing.outcome !== emit.outcome) {
      throw new DAGError(
        `DAGDeriver: emit terminal name '${emit.name}' is declared with conflicting outcomes: '${existing.outcome}' vs '${emit.outcome}'`,
      );
    }
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

    // Collect all synthesized TerminalNode placements from `emit` annotations.
    // Keyed by placement name; populated incrementally as each operation is
    // rendered and its terminals are resolved.
    const emitCollector = new Map<string, DAGDeriverEmitTerminal>();

    // All operation names that will be placed as SingleNode/ScatterNode/etc.
    // Used to detect name collisions with emit terminal names.
    const operationNames = new Set<string>(contracts.keys());

    buckets.forEach((bucket) => {
      for (const name of bucket) {
        const scatter = annotations.scatters?.[name];
        const embeddedDAG = annotations.embeddedDAGs?.[name];
        const succs = edges.get(name) ?? new Set<string>();

        if (scatter !== undefined && embeddedDAG !== undefined) {
          throw new DAGError(
            `DAGDeriver: operation '${name}' appears in both annotations.scatters and annotations.embeddedDAGs; placement kind must be unambiguous`,
          );
        }

        if (scatter !== undefined) {
          nodes.push(DAGDeriver.renderScatterNode(name, scatter, succs, annotations, nodeId, emitCollector));
        } else if (embeddedDAG !== undefined) {
          nodes.push(DAGDeriver.renderEmbeddedDAGNode(name, embeddedDAG, succs, annotations, nodeId, emitCollector));
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
              emitCollector,
            ),
          };
          nodes.push(single);
        }
      }
    });

    // Validate emit terminal names do not collide with operation placements,
    // then synthesize and append TerminalNode placements.
    for (const [emitName, emit] of emitCollector) {
      if (operationNames.has(emitName)) {
        throw new DAGError(
          `DAGDeriver: emit terminal name '${emitName}' collides with an existing operation placement; choose a distinct name`,
        );
      }
      const terminalNode: TerminalNodePlacementInterface = {
        '@id':     nodeId(emitName),
        '@type':   'TerminalNode',
        'name':    emitName,
        'outcome': emit.outcome,
      };
      nodes.push(terminalNode);
    }

    return nodes;
  }

  /**
   * Render a `ScatterNode` placement from a `DAGDeriverScatter` annotation.
   *
   * A scatter runs its per-item `node` body once per item in `source`. The
   * gather `strategy` maps onto the scatter's `gather` config:
   *   ⦿ `custom`    → `{ strategy: 'custom', customNode }`
   *   ⦿ `partition` → `{ strategy: 'partition', partitions }`
   *   ⦿ `append`    → `{ strategy: 'append', target }`
   */
  private static renderScatterNode(
    name: string,
    scatter: DAGDeriverScatter,
    successors: ReadonlySet<string>,
    annotations: DAGDeriverAnnotations,
    nodeId: (n: string) => string,
    emitCollector: Map<string, DAGDeriverEmitTerminal>,
  ): ScatterNode {
    const next0 = [...successors][0] ?? null;
    const outcomeOverrides = new Map<string, string | null>();
    for (const terminal of annotations.terminals?.[name] ?? []) {
      if (!scatter.outcomes.includes(terminal.outcome)) {
        throw new DAGError(
          `DAGDeriver: terminal for scatter '${name}' references outcome '${terminal.outcome}' which is not in outcomes [${scatter.outcomes.join(', ')}]`,
        );
      }
      if ('emit' in terminal) {
        DAGDeriver.collectEmit(terminal.emit, emitCollector);
        outcomeOverrides.set(terminal.outcome, terminal.emit.name);
      } else {
        outcomeOverrides.set(terminal.outcome, terminal.target);
      }
    }
    const outputs: Record<string, string | null> = {};
    for (const outcome of scatter.outcomes) {
      outputs[outcome] = outcomeOverrides.has(outcome)
        ? outcomeOverrides.get(outcome) ?? null
        : next0;
    }

    let gather: ScatterNode['gather'];
    if (scatter.strategy === 'custom') {
      gather = { 'strategy': 'custom', 'customNode': scatter.customNode };
    } else if (scatter.strategy === 'partition') {
      gather = { 'strategy': 'partition', 'partitions': { ...scatter.partitions } };
    } else {
      gather = { 'strategy': 'append', 'target': scatter.target };
    }

    const scatterNode: ScatterNode = {
      '@id':     nodeId(name),
      '@type':   'ScatterNode',
      name,
      'body':    { 'node': scatter.node },
      'source':  scatter.source,
      'itemKey': scatter.itemKey,
      'gather':  gather,
      'outputs': outputs,
    };
    if (scatter.concurrency !== undefined) scatterNode.concurrency = scatter.concurrency;
    return scatterNode;
  }

  /**
   * Render an `EmbeddedDAGNode` placement from a `DAGDeriverEmbeddedDAG`
   * annotation.
   *
   * An embedded-DAG runs a named sub-DAG at cardinality 1. The
   * `stateMapping` is forwarded directly onto the `EmbeddedDAGNode` wire
   * shape:
   *   ⦿ `stateMapping.input`  (child key → parent path) seeds the child
   *     state from the parent before the sub-DAG runs.
   *   ⦿ `stateMapping.output` (parent path → child key) copies child
   *     state back to the parent after the sub-DAG completes.
   */
  private static renderEmbeddedDAGNode(
    name: string,
    embeddedDAG: DAGDeriverEmbeddedDAG,
    successors: ReadonlySet<string>,
    annotations: DAGDeriverAnnotations,
    nodeId: (n: string) => string,
    emitCollector: Map<string, DAGDeriverEmitTerminal>,
  ): EmbeddedDAGNode {
    const embeddedNode: EmbeddedDAGNode = {
      '@id':   nodeId(name),
      '@type': 'EmbeddedDAGNode',
      name,
      'dag':   embeddedDAG.dag,
      'outputs': DAGDeriver.resolveOutputs(
        name,
        embeddedDAG.outputs,
        `embeddedDAG '${embeddedDAG.dag}' declared outputs`,
        successors,
        annotations,
        emitCollector,
      ),
    };

    const mapping = embeddedDAG.stateMapping;
    if (mapping?.input !== undefined || mapping?.output !== undefined) {
      const stateMapping: EmbeddedDAGNode['stateMapping'] = {};
      if (mapping?.input !== undefined) {
        stateMapping.input = { ...(mapping.input as Record<string, string>) };
      }
      if (mapping?.output !== undefined) {
        stateMapping.output = { ...(mapping.output as Record<string, string>) };
      }
      embeddedNode.stateMapping = stateMapping;
    }

    return embeddedNode;
  }
}
