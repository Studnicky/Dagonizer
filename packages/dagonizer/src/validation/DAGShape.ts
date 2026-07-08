import type { DAGType } from '../entities/dag/DAG.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import { Placement } from '../entities/dag/Placement.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type { SingleNodePlacementType } from '../entities/dag/SingleNode.js';
import { DAGError } from '../errors/index.js';

export class DAGShape {
  private constructor() { /* static class */ }

  static validate(dag: DAGType): void {
    const errors: string[] = [];
    const nodeNames = new Set<string>();

    for (const node of dag.nodes) {
      if (nodeNames.has(node.name)) {
        errors.push(`Duplicate node name: ${node.name}`);
      }
      nodeNames.add(node.name);
    }

    for (const [label, entrypoint] of Object.entries(dag.entrypoints)) {
      if (label.length === 0) {
        errors.push(`Entrypoint label must be non-empty`);
      }
      if (!nodeNames.has(entrypoint)) {
        errors.push(`Entrypoint '${label}' targets '${entrypoint}' which does not exist in nodes`);
      }
    }

    const producerLabels = DAGShape.gatherProducerLabels(dag);
    for (const node of dag.nodes) {
      DAGShape.validatePlacement(node, nodeNames, producerLabels, errors);
    }

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validatePlacement(
    entry: DAGNodeType,
    nodeNames: ReadonlySet<string>,
    producerLabels: ReadonlySet<string>,
    errors: string[],
  ): void {
    if (Placement.isEmbeddedDAG(entry)) {
      DAGShape.validateEmbeddedDAGNode(entry, nodeNames, errors);
    } else if (Placement.isScatter(entry)) {
      DAGShape.validateScatterNode(entry, nodeNames, errors);
    } else if (Placement.isSingle(entry)) {
      DAGShape.validateSingleNode(entry, nodeNames, errors);
    } else if (Placement.isGather(entry)) {
      DAGShape.validateGatherNode(entry, nodeNames, producerLabels, errors);
    }
  }

  private static validateSingleNode(
    nodeConfig: SingleNodePlacementType,
    nodeNames: ReadonlySet<string>,
    errors: string[],
  ): void {
    for (const [output, target] of Object.entries(nodeConfig.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`Node '${nodeConfig.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNodeType,
    nodeNames: ReadonlySet<string>,
    errors: string[],
  ): void {
    if (placement.dag === undefined) {
      errors.push(`EmbeddedDAGNode '${placement.name}': requires dag`);
    } else if (typeof placement.dag !== 'string' && placement.dag.from !== 'state') {
      errors.push(`EmbeddedDAGNode '${placement.name}': dynamic dag reference must use from='state'`);
    }

    for (const [output, target] of Object.entries(placement.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`EmbeddedDAGNode '${placement.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
  }

  private static validateScatterNode(
    scatter: ScatterNodeType,
    nodeNames: ReadonlySet<string>,
    errors: string[],
  ): void {
    if ('node' in scatter.body && scatter.container !== undefined) {
      errors.push(`ScatterNode '${scatter.name}' has a node body; 'container' is only valid for a dag body`);
    }

    for (const [output, target] of Object.entries(scatter.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`ScatterNode '${scatter.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }

    if ('dag' in scatter.body && typeof scatter.body.dag !== 'string' && scatter.body.dag.from !== 'item') {
      errors.push(`ScatterNode '${scatter.name}': dynamic dag reference must use from='item'`);
    }

    if (scatter.execution !== undefined && scatter.execution.mode === 'reservoir') {
      DAGShape.validateReservoir(scatter, scatter.execution.reservoir, errors);
    }
  }

  private static validateGatherNode(
    gather: GatherNodeType,
    nodeNames: ReadonlySet<string>,
    producerLabels: ReadonlySet<string>,
    errors: string[],
  ): void {
    for (const [output, target] of Object.entries(gather.outputs)) {
      if (!nodeNames.has(target)) {
        errors.push(`GatherNode '${gather.name}': output '${output}' routes to unknown node '${target}'`);
      }
    }
    for (const source of gather.sources) {
      if (!producerLabels.has(source)) {
        errors.push(`GatherNode '${gather.name}': source '${source}' is not declared by an entrypoint or producer placement`);
      }
    }
    if (gather.policy?.quorum !== undefined && gather.policy.mode !== 'quorum') {
      errors.push(`GatherNode '${gather.name}': policy.quorum is only valid when policy.mode is 'quorum'`);
    }
    if (gather.policy?.mode === 'quorum' && gather.policy.quorum !== undefined && gather.policy.quorum > gather.sources.length) {
      errors.push(`GatherNode '${gather.name}': policy.quorum ${gather.policy.quorum} exceeds source count ${gather.sources.length}`);
    }
  }

  private static gatherProducerLabels(dag: DAGType): ReadonlySet<string> {
    const labels = new Set(Object.keys(dag.entrypoints));
    const gatherNames = new Set(
      dag.nodes
        .filter((node) => Placement.isGather(node))
        .map((node) => node.name),
    );

    for (const node of dag.nodes) {
      if (!('outputs' in node)) continue;
      if (Object.values(node.outputs).some((target) => gatherNames.has(target))) {
        labels.add(node.name);
      }
    }

    return labels;
  }

  private static validateReservoir(
    scatter: ScatterNodeType,
    reservoir: { keyField: string; capacity: number; idleMs?: number },
    errors: string[],
  ): void {
    if (reservoir.keyField.trim().length === 0) {
      errors.push(`ScatterNode '${scatter.name}' execution.reservoir.keyField must be a non-empty accessor path`);
    }

    if (reservoir.capacity < 1) {
      errors.push(`ScatterNode '${scatter.name}' execution.reservoir.capacity must be >= 1 (got ${reservoir.capacity})`);
    }

    if (reservoir.idleMs !== undefined && reservoir.idleMs < 1) {
      errors.push(`ScatterNode '${scatter.name}' execution.reservoir.idleMs must be > 0 when present (got ${reservoir.idleMs})`);
    }
  }
}
