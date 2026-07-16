import type { InspectSelectionType } from './InspectSelection.js';

export type ToolInspectorTargetType = {
  readonly 'variant': 'tool';
  readonly 'name': string;
};

export type InspectorTargetType =
  | ToolInspectorTargetType
  | InspectSelectionType;

export function toolInspectorTarget(name: string): ToolInspectorTargetType {
  return { 'variant': 'tool', name };
}

export function isToolInspectorTarget(target: InspectorTargetType | null): target is ToolInspectorTargetType {
  return target !== null && target.variant === 'tool';
}

export function isInspectSelectionTarget(target: InspectorTargetType | null): target is InspectSelectionType {
  return target !== null && target.variant !== 'tool';
}
