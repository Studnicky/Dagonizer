import type { NodeInterface } from '../contracts/NodeInterface.js';
import type { DAGType } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { PhaseNodeType } from '../entities/dag/PhaseNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import { DAGError, ValidationError } from '../errors/index.js';
import type { NodeStateInterface } from '../NodeStateBase.js';

export class DAGValidator {
  private constructor() { /* static class */ }

  static validateDAGConfig<TState extends NodeStateInterface, TServices>(
    dag: DAGType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
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
      DAGValidator.validateDAGNode(node, nodes, dags, nodeNames, errors);
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

  private static validateDAGNode<TState extends NodeStateInterface, TServices>(
    entry: DAGNodeType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAGType>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if (Placement.isEmbeddedDAG(entry)) {
      DAGValidator.validateEmbeddedDAGNode(entry, dags, nodeNames, errors);
    } else if (Placement.isScatter(entry)) {
      DAGValidator.validateScatterNode(entry, nodes, dags, nodeNames, errors);
    } else if (Placement.isSingle(entry)) {
      DAGValidator.validateSingleNode(entry, nodes, nodeNames, errors);
    } else if (Placement.isPhase(entry)) {
      DAGValidator.validatePhaseNode(entry, nodes, errors);
    }
    // TerminalNode: no outputs to validate; schema pass is sufficient.
  }

  private static validatePhaseNode<TState extends NodeStateInterface, TServices>(
    phase: PhaseNodeType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    errors: string[],
  ): void {
    if (!nodes.has(phase.node)) {
      errors.push(`PhaseNode '${phase.name}' references unknown registered node: ${phase.node}`);
    }
  }

  private static validateSingleNode<TState extends NodeStateInterface, TServices>(
    nodeConfig: SingleNodePlacementType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    const dagNode = nodes.get(nodeConfig.node);

    if (!dagNode) {
      errors.push(`Node '${nodeConfig.name}' references unknown registered node: ${nodeConfig.node}`);
      return;
    }

    for (const output of dagNode.outputs) {
      if (!(output in nodeConfig.outputs)) {
        errors.push(`Node '${nodeConfig.name}': registered node '${dagNode.name}' declares output '${output}' but no routing is defined`);
      }
    }

    for (const [output, target] of Object.entries(nodeConfig.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`Node '${nodeConfig.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNodeType,
    dags: Map<string, DAGType>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if (!dags.has(placement.dag)) {
      errors.push(`EmbeddedDAGNode '${placement.name}': unknown registered DAG '${placement.dag}'`);
    }

    for (const [output, target] of Object.entries(placement.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`EmbeddedDAGNode '${placement.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateScatterNode<TState extends NodeStateInterface, TServices>(
    scatter: ScatterNodeType,
    nodes: Map<string, NodeInterface<TState, string, TServices>>,
    dags: Map<string, DAGType>,
    nodeNames: Set<string>,
    errors: string[],
  ): void {
    if ('node' in scatter.body) {
      // A node body with a container key is invalid: a node body is one node, not a DAG.
      // Container is only valid for dag bodies. Throw immediately — this is a structural
      // error that must surface before any execution.
      if (scatter.container !== undefined) {
        throw new ValidationError(
          `ScatterNode '${scatter.name}' has a node body; 'container' is only valid for a dag body`,
        );
      }
      if (!nodes.has(scatter.body.node)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered node '${scatter.body.node}'`);
      }
    } else {
      if (!dags.has(scatter.body.dag)) {
        errors.push(`ScatterNode '${scatter.name}': unknown registered DAG '${scatter.body.dag}'`);
      }
    }

    const gather = scatter.gather;
    if (gather.strategy === 'custom' && gather.customNode !== undefined && !nodes.has(gather.customNode)) {
      errors.push(`ScatterNode '${scatter.name}': custom gather node '${gather.customNode}' not found`);
    }

    for (const [output, target] of Object.entries(scatter.outputs)) {
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
