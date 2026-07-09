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
    const placementIris = new Set<string>();

    for (const node of dag.nodes) {
      if (nodeNames.has(node.name)) {
        errors.push(`Duplicate node name: ${node.name}`);
      }
      nodeNames.add(node.name);
      if (placementIris.has(node['@id'])) {
        errors.push(`Duplicate placement IRI: ${node['@id']}`);
      }
      placementIris.add(node['@id']);
    }

    for (const [label, entrypoint] of Object.entries(dag.entrypoints)) {
      if (label.length === 0) {
        errors.push(`Entrypoint label must be non-empty`);
      }
      if (!placementIris.has(entrypoint)) {
        errors.push(`Entrypoint '${label}' targets '${entrypoint}' which does not exist in nodes`);
      }
    }

    const producerLabels = DAGShape.gatherProducerLabels(dag);
    for (const node of dag.nodes) {
      DAGShape.validatePlacement(node, placementIris, producerLabels, errors);
    }

    if (errors.length > 0) {
      throw new DAGError(`Invalid DAG '${dag.name}':\n  - ${errors.join('\n  - ')}`);
    }
  }

  private static validatePlacement(
    entry: DAGNodeType,
    placementIris: ReadonlySet<string>,
    producerLabels: ReadonlySet<string>,
    errors: string[],
  ): void {
    if (Placement.isEmbeddedDAG(entry)) {
      DAGShape.validateEmbeddedDAGNode(entry, placementIris, errors);
    } else if (Placement.isScatter(entry)) {
      DAGShape.validateScatterNode(entry, placementIris, errors);
    } else if (Placement.isSingle(entry)) {
      DAGShape.validateSingleNode(entry, placementIris, errors);
    } else if (Placement.isGather(entry)) {
      DAGShape.validateGatherNode(entry, placementIris, producerLabels, errors);
    }
  }

  private static validateSingleNode(
    nodeConfig: SingleNodePlacementType,
    placementIris: ReadonlySet<string>,
    errors: string[],
  ): void {
    for (const [output, target] of Object.entries(nodeConfig.outputs)) {
      if (!placementIris.has(target)) {
        errors.push(`Node '${nodeConfig.name}': output '${output}' routes to unknown placement IRI '${target}'`);
      }
    }
  }

  private static validateEmbeddedDAGNode(
    placement: EmbeddedDAGNodeType,
    placementIris: ReadonlySet<string>,
    errors: string[],
  ): void {
    if (placement.dag === undefined) {
      errors.push(`EmbeddedDAGNode '${placement.name}': requires dag`);
    } else if (typeof placement.dag !== 'string' && placement.dag.from !== 'state') {
      errors.push(`EmbeddedDAGNode '${placement.name}': dynamic dag reference must use from='state'`);
    }

    for (const [output, target] of Object.entries(placement.outputs)) {
      if (!placementIris.has(target)) {
        errors.push(`EmbeddedDAGNode '${placement.name}': output '${output}' routes to unknown placement IRI '${target}'`);
      }
    }
  }

  private static validateScatterNode(
    scatter: ScatterNodeType,
    placementIris: ReadonlySet<string>,
    errors: string[],
  ): void {
    if ('node' in scatter.body && scatter.container !== undefined) {
      errors.push(`ScatterNode '${scatter.name}' has a node body; 'container' is only valid for a dag body`);
    }

    for (const [output, target] of Object.entries(scatter.outputs)) {
      if (!placementIris.has(target)) {
        errors.push(`ScatterNode '${scatter.name}': output '${output}' routes to unknown placement IRI '${target}'`);
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
    placementIris: ReadonlySet<string>,
    producerLabels: ReadonlySet<string>,
    errors: string[],
  ): void {
    for (const [output, target] of Object.entries(gather.outputs)) {
      if (!placementIris.has(target)) {
        errors.push(`GatherNode '${gather.name}': output '${output}' routes to unknown placement IRI '${target}'`);
      }
    }
    for (const source of Object.keys(gather.sources)) {
      if (!producerLabels.has(source)) {
        errors.push(`GatherNode '${gather.name}': source '${source}' is not declared by an entrypoint or producer placement`);
      }
    }
    if (gather.policy?.quorum !== undefined && gather.policy.mode !== 'quorum') {
      errors.push(`GatherNode '${gather.name}': policy.quorum is only valid when policy.mode is 'quorum'`);
    }
    const sourceCount = Object.keys(gather.sources).length;
    if (gather.policy?.mode === 'quorum' && gather.policy.quorum !== undefined && gather.policy.quorum > sourceCount) {
      errors.push(`GatherNode '${gather.name}': policy.quorum ${gather.policy.quorum} exceeds source count ${sourceCount}`);
    }
  }

  private static gatherProducerLabels(dag: DAGType): ReadonlySet<string> {
    const labels = new Set(Object.entries(dag.entrypoints).map(([label]) => `${dag['@id']}/entrypoint/${encodeURIComponent(label)}`));
    const gatherNames = new Set(
      dag.nodes
        .filter((node) => Placement.isGather(node))
        .map((node) => node['@id']),
    );

    for (const node of dag.nodes) {
      if (!('outputs' in node)) continue;
      if (Object.values(node.outputs).some((target) => gatherNames.has(target))) {
        labels.add(node['@id']);
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
