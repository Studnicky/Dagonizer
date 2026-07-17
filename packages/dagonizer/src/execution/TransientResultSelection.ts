import { GatherStrategies } from '../core/GatherStrategies.js';
import type { EmbeddedDAGNodeType } from '../entities/dag/EmbeddedDAGNode.js';
import { EmbeddedDAGNodeDefaults } from '../entities/dag/EmbeddedDAGNode.js';
import type { GatherNodeType } from '../entities/dag/GatherNode.js';
import type { DAGNodeType } from '../entities/dag/Placement.js';
import { Placement } from '../entities/dag/Placement.js';
import type { ScatterNodeType } from '../entities/dag/ScatterNode.js';
import type {
  TransientNodeStateResponseStateType,
  TransientNodeStateSelectionType,
} from '../entities/executor/TransientNodeState.js';

const EMPTY_RESPONSE_SELECTION: TransientNodeStateSelectionType = Object.freeze({
  'mode': 'selection',
  'domainPaths': [],
  'metadataKeys': [],
});

const FULL_RESPONSE_SELECTION: TransientNodeStateSelectionType = Object.freeze({
  'mode': 'full',
  'domainPaths': [],
  'metadataKeys': [],
});

export class TransientResultSelection {
  private constructor() { /* static-only */ }

  static empty(): TransientNodeStateSelectionType {
    return EMPTY_RESPONSE_SELECTION;
  }

  static full(): TransientNodeStateSelectionType {
    return FULL_RESPONSE_SELECTION;
  }

  static merge(...selections: readonly TransientNodeStateSelectionType[]): TransientNodeStateSelectionType {
    if (selections.some((selection) => selection.mode === 'full')) {
      return FULL_RESPONSE_SELECTION;
    }
    const domainPaths = new Set<string>();
    const metadataKeys = new Set<string>();
    for (const selection of selections) {
      for (const path of selection.domainPaths) domainPaths.add(path);
      for (const key of selection.metadataKeys) metadataKeys.add(key);
    }
    return {
      'mode': 'selection',
      'domainPaths': [...domainPaths],
      'metadataKeys': [...metadataKeys],
    };
  }

  static forEmbeddedPlacement(placement: EmbeddedDAGNodeType): TransientNodeStateSelectionType {
    const outputMapping = EmbeddedDAGNodeDefaults.outputMapping(placement);
    const mappedPaths = Object.values(outputMapping);
    return TransientResultSelection.merge({
      'mode': 'selection',
      'domainPaths': mappedPaths,
      'metadataKeys': [],
    }, placement.gatherResult?.resultField === undefined
      ? EMPTY_RESPONSE_SELECTION
      : {
        'mode': 'selection',
        'domainPaths': [placement.gatherResult.resultField],
        'metadataKeys': [],
      });
  }

  static embeddedResponseState(placement: EmbeddedDAGNodeType): TransientNodeStateResponseStateType {
    return {
      'defaultSelection': TransientResultSelection.forEmbeddedPlacement(placement),
      'outputSelections': {},
    };
  }

  static forGatherTarget(gatherTarget: GatherNodeType, sourceIri: string): TransientNodeStateSelectionType {
    const strategySelection = GatherStrategies.resolve(gatherTarget.gather.strategy).transientResultSelection(gatherTarget.gather);
    const resultField = gatherTarget.sources[sourceIri]?.resultField;
    if (resultField === undefined) return strategySelection;
    return TransientResultSelection.merge(strategySelection, {
      'mode': 'selection',
      'domainPaths': [resultField],
      'metadataKeys': [],
    });
  }

  static forScatterPlacement(
    scatter: ScatterNodeType,
    nodeIndex: ReadonlyMap<string, DAGNodeType>,
  ): TransientNodeStateSelectionType {
    const selections: TransientNodeStateSelectionType[] = [];
    for (const targetIri of Object.values(scatter.outputs)) {
      if (targetIri === null) continue;
      const node = nodeIndex.get(targetIri);
      if (node === undefined || !Placement.isGather(node)) continue;
      selections.push(TransientResultSelection.forGatherTarget(node, scatter['@id']));
    }
    return selections.length === 0
      ? EMPTY_RESPONSE_SELECTION
      : TransientResultSelection.merge(...selections);
  }

  static scatterResponseState(
    scatter: ScatterNodeType,
    nodeIndex: ReadonlyMap<string, DAGNodeType>,
  ): TransientNodeStateResponseStateType {
    const outputSelections: Record<string, TransientNodeStateSelectionType> = {};
    for (const [output, targetIri] of Object.entries(scatter.outputs)) {
      if (targetIri === null) continue;
      const node = nodeIndex.get(targetIri);
      if (node === undefined || !Placement.isGather(node)) continue;
      outputSelections[output] = TransientResultSelection.forGatherTarget(node, scatter['@id']);
    }
    return {
      'defaultSelection': EMPTY_RESPONSE_SELECTION,
      outputSelections,
    };
  }
}
