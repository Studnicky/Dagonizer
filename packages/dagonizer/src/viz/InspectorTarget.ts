import type { InspectSelectionType } from './InspectSelection.js';

export type ToolInspectorTargetType = {
  readonly 'variant': 'tool';
  readonly 'name': string;
};

export type InspectorTargetType =
  | ToolInspectorTargetType
  | InspectSelectionType;

export class InspectorTarget {
  private constructor() { /* static-only */ }

  static tool(name: string): ToolInspectorTargetType {
    return { 'variant': 'tool', name };
  }

  static isTool(target: InspectorTargetType | null): target is ToolInspectorTargetType {
    return target !== null && target.variant === 'tool';
  }

  static isInspectSelection(target: InspectorTargetType | null): target is InspectSelectionType {
    return target !== null && target.variant !== 'tool';
  }
}
