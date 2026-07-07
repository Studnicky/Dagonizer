import type { NodeInterface } from '../contracts/NodeInterface.js';
import { ContextResolver } from '../dag/ContextResolver.js';
import type { DAGType } from '../entities/dag/DAG.js';
import { DagReference } from '../entities/dag/DagReference.js';
import type { DagReferenceType } from '../entities/dag/DagReference.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherConfigType } from '../entities/dag/GatherConfig.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
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
    for (const node of dag.nodes) {
      DAGValidator.validateDAGNode(node, context, nodes, dags, errors);
    }

    // No sub-DAG cycle detection is needed. `registerDAG` is append-only (a
    // duplicate expanded IRI throws), and every EmbeddedDAGNode/ScatterNode body must
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
    errors: string[],
  ): void {
    if (Placement.isEmbeddedDAG(entry)) {
      DAGValidator.validateEmbeddedDAGNode(entry, context, dags, errors);
    } else if (Placement.isScatter(entry)) {
      DAGValidator.validateScatterNode(entry, context, nodes, dags, errors);
    } else if (Placement.isSingle(entry)) {
      DAGValidator.validateSingleNode(entry, context, nodes, errors);
    } else if (Placement.isGather(entry)) {
      DAGValidator.validateGatherNode(entry, context, nodes, errors);
    } else if (Placement.isPhase(entry)) {
      DAGValidator.validatePhaseNode(entry, context, nodes, errors);
    }
    // TerminalNode: no registry-relative references to validate.
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
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNodeType,
    context: Record<string, unknown>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if (placement.dag !== undefined) {
      DAGValidator.validateDagReference(placement.dag, context, dags, `EmbeddedDAGNode '${placement.name}'`, errors);
    }
  }

  private static validateScatterNode<TState extends NodeStateInterface>(
    scatter: ScatterNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    dags: Map<string, DAGType>,
    errors: string[],
  ): void {
    if ('node' in scatter.body) {
      const bodyNodeIri = ContextResolver.expand(scatter.body.node, context);
      if (!nodes.has(bodyNodeIri)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered node '${scatter.body.node}'`);
      }
    } else if ('dag' in scatter.body) {
      DAGValidator.validateDagReference(scatter.body.dag, context, dags, `ScatterNode '${scatter.name}'`, errors);
    }

    DAGValidator.validateGatherConfig(scatter.name, scatter.gather, context, nodes, errors);
  }

  private static validateGatherNode<TState extends NodeStateInterface>(
    gatherNode: GatherNodeType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    DAGValidator.validateGatherConfig(gatherNode.name, gatherNode.gather, context, nodes, errors);
  }

  private static validateGatherConfig<TState extends NodeStateInterface>(
    ownerName: string,
    gather: GatherConfigType,
    context: Record<string, unknown>,
    nodes: Map<string, NodeInterface<TState, string>>,
    errors: string[],
  ): void {
    if (gather.strategy === 'custom' && gather.customNode !== undefined) {
      const customNodeIri = ContextResolver.expand(gather.customNode, context);
      if (!nodes.has(customNodeIri)) {
        errors.push(`Gather '${ownerName}': custom gather node '${gather.customNode}' not found`);
      }
    }
  }

  private static validateDagReference(
    reference: DagReferenceType,
    context: Record<string, unknown>,
    dags: Map<string, DAGType>,
    owner: string,
    errors: string[],
  ): void {
    for (const candidate of DagReference.candidates(reference)) {
      const dagIri = ContextResolver.expand(candidate, context);
      if (!dags.has(dagIri)) {
        errors.push(`${owner}: unknown registered DAG '${candidate}'`);
      }
    }
  }
}
