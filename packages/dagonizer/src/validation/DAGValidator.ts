import type { NodeInterface } from '../contracts/NodeInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class DAGValidator {
  private constructor() { /* static class */ }

  static validateDAGConfig<TState extends NodeStateInterface>(
    dag: DAGType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
  ): void {
    const errors: string[] = [];
    const nodeNames = new Set<string>();

    for (const node of dag.nodes) {
      if (nodeNames.has(node.name)) {
        errors.push(`Duplicate node name: ${node.name}`);
      }
      nodeNames.add(node.name);
    }

    if (!nodeNames.has(dag.entrypoint)) {
      errors.push(`Entrypoint '${dag.entrypoint}' does not exist in nodes`);
    }

    for (const node of dag.nodes) {
      DAGValidator.validateDAGNode(node, context, nodes, dags, nodeNames, errors);
    }

    // No sub-DAG cycle detection is needed. `registerDAG` is append-only (a
    // duplicate name throws), and every EmbeddedDAGNode/ScatterNode body must
    // reference an already-registered DAG (validated above). Sub-DAG references
    // are therefore backward-only, so the reference graph is necessarily
    // acyclic — a cycle cannot be constructed through the public registry.

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validateDAGNode<TState extends NodeStateInterface>(
    entry: DAGNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if (Placement.isEmbeddedDAG(entry)) {
      DAGValidator.validateEmbeddedDAGNode(entry, context, dags, nodeNames, errors);
    } else if (Placement.isScatter(entry)) {
      DAGValidator.validateScatterNode(entry, context, nodes, dags, nodeNames, errors);
    } else if (Placement.isSingle(entry)) {
      DAGValidator.validateSingleNode(entry, context, nodes, nodeNames, errors);
    } else if (Placement.isPhase(entry)) {
      DAGValidator.validatePhaseNode(entry, context, nodes, errors);
    }
    // TerminalNode: no outputs to validate; schema pass is sufficient.
  }

  private static validatePhaseNode<TState extends NodeStateInterface>(
    phase: PhaseNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    const nodeIri = ContextResolver.expand(phase.node, context);
    if (!nodes.has(nodeIri)) {
      errors.push(`PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`);
    }
  }

  private static validateSingleNode<TState extends NodeStateInterface>(
    nodeConfig: SingleNodePlacementType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    const nodeIri = ContextResolver.expand(nodeConfig.node, context);
    const dagNode = nodes.get(nodeIri);

    if (!dagNode) {
      errors.push(`Node '${nodeConfig.name}' references unknown registered node: ${nodeConfig.node}`);
      return;
    }

    for (const output of dagNode.outputs) {
      // 'parked' is a reserved engine-level output for HITL park-and-correlate.
      // The engine intercepts it before routing; no placement-level routing entry is required.
      if (output === 'parked') continue;
      if (!(output in nodeConfig.outputs)) {
        errors.push(`Node '${nodeConfig.name}': registered node '${dagNode.name}' declares output '${output}' but no routing is defined`);
      }
    }

    for (const [output, target] of Object.entries(nodeConfig.outputs)) {
      // target is a placement name (intra-DAG identifier), not an IRI — nodeNames are bare.
      if (!nodeNames.has(target)) {
        errors.push(`Node '${nodeConfig.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNodeType,
    context: Record<string, unknown>,
    dags: Map<string, DAGType>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    // Exactly one of `dag` (build-time literal) or `dagFrom` (runtime path) must be set.
    if (placement.dag !== undefined && placement.dagFrom !== undefined) {
      errors.push(`EmbeddedDAGNode '${placement.name}': requires exactly one of dag or dagFrom, not both`);
    } else if (placement.dag === undefined && placement.dagFrom === undefined) {
      errors.push(`EmbeddedDAGNode '${placement.name}': requires exactly one of dag or dagFrom`);
    }

    // `dag` is the build-time literal name; validate it against the registry using IRI expansion.
    // `dagFrom` resolves at runtime from state — no static validation is possible.
    if (placement.dag !== undefined) {
      const dagIri = ContextResolver.expand(placement.dag, context);
      if (!dags.has(dagIri)) {
        errors.push(`EmbeddedDAGNode '${placement.name}': unknown registered DAG '${placement.dag}'`);
      }
    }

    for (const [output, target] of Object.entries(placement.outputs)) {
      // target is a placement name (intra-DAG identifier) — bare, not IRI-expanded.
      if (!nodeNames.has(target)) {
        errors.push(`EmbeddedDAGNode '${placement.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateScatterNode<TState extends NodeStateInterface>(
    scatter: ScatterNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if ('node' in scatter.body) {
      // A node body with a container key is invalid: a node body is one node, not a DAG.
      // Container is only valid for dag bodies. Throw immediately — this is a structural
      // error that must surface before any execution.
      if (scatter.container !== undefined) {
        throw new DAGError(
          `ScatterNode '${scatter.name}' has a node body; 'container' is only valid for a dag body`,
          { 'code': 'VALIDATION_ERROR' },
        );
      }
      const bodyNodeIri = ContextResolver.expand(scatter.body.node, context);
      if (!nodes.has(bodyNodeIri)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered node '${scatter.body.node}'`);
      }
    } else if ('dag' in scatter.body) {
      const bodyDagIri = ContextResolver.expand(scatter.body.dag, context);
      if (!dags.has(bodyDagIri)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered DAG '${scatter.body.dag}'`);
      }
    }
    // 'dagFrom' bodies reference a runtime-resolved DAG name; not validated at registration time.

    const gather = scatter.gather;
    if (gather.strategy === 'custom' && gather.customNode !== undefined) {
      const customNodeIri = ContextResolver.expand(gather.customNode, context);
      if (!nodes.has(customNodeIri)) {
        errors.push(`ScatterNode '${scatter.name}': custom gather node '${gather.customNode}' not found`);
      }
    }

    for (const [output, target] of Object.entries(scatter.outputs)) {
      // target is a placement name (intra-DAG identifier) — bare, not IRI-expanded.
      if (!nodeNames.has(target)) {
        errors.push(`ScatterNode '${scatter.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }

    if (scatter.reservoir !== undefined) {
      DAGValidator.validateReservoir(scatter, errors);
    }
  }

  private static validateReservoir(
    scatter: ScatterNodeType,
    errors: string[],
  ): void {
    // reservoir is already narrowed to defined by the caller; assert shape exists.
    const reservoir = scatter.reservoir;
    if (reservoir === undefined) return;

    // keyField: schema enforces minLength:1 but surface a clear semantic message.
    if (reservoir.keyField.trim().length === 0) {
      errors.push(`ScatterNode '${scatter.name}' reservoir.keyField must be a non-empty accessor path`);
    }

    // capacity: schema enforces minimum:1 but surface a clear semantic message.
    if (reservoir.capacity < 1) {
      errors.push(`ScatterNode '${scatter.name}' reservoir.capacity must be >= 1 (got ${reservoir.capacity})`);
    }

    // idleMs: schema enforces minimum:1 but surface a clear semantic message.
    if (reservoir.idleMs !== undefined && reservoir.idleMs < 1) {
      errors.push(`ScatterNode '${scatter.name}' reservoir.idleMs must be > 0 when present (got ${reservoir.idleMs})`);
    }

  }
}
