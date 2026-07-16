import type { InspectSelectionType } from './InspectSelection.js';
import type { InspectorTargetType, ToolInspectorTargetType } from './InspectorTarget.js';
import { isInspectSelectionTarget, isToolInspectorTarget, toolInspectorTarget } from './InspectorTarget.js';

export type SelectionControllerHooksType = {
  'onSelectionChange'?: (target: InspectorTargetType | null) => void;
};

export class SelectionController {
  #target: InspectorTargetType | null = null;
  readonly #hooks: SelectionControllerHooksType;

  constructor(hooks: SelectionControllerHooksType = {}) {
    this.#hooks = hooks;
  }

  target(): InspectorTargetType | null {
    return this.#target;
  }

  select(target: InspectorTargetType | null): void {
    this.#target = target;
    this.#hooks.onSelectionChange?.(target);
  }

  clear(): void {
    this.select(null);
  }

  selectTool(name: string): void {
    this.select(toolInspectorTarget(name));
  }

  selectInspect(selection: InspectSelectionType | null): void {
    this.select(selection);
  }

  selectedTool(): string | null {
    return isToolInspectorTarget(this.#target) ? this.#target.name : null;
  }

  selectedInspect(): InspectSelectionType | null {
    return isInspectSelectionTarget(this.#target) ? this.#target : null;
  }

  isToolSelected(name: string): boolean {
    return isToolInspectorTarget(this.#target) && this.#target.name === name;
  }

  isInspectSelected(target: InspectSelectionType): boolean {
    const current = this.selectedInspect();
    if (current === null) return false;
    return inspectSelectionKey(current) === inspectSelectionKey(target);
  }
}

function inspectSelectionKey(target: InspectSelectionType): string {
  switch (target.variant) {
    case 'dag-node':
      return `dag-node:${target.name}`;
    case 'iri':
      return `iri:${target.iri}`;
    case 'literal':
      return `literal:${target.value}`;
  }
}

export function selectedToolName(target: InspectorTargetType | null): string | null {
  return isToolInspectorTarget(target) ? target.name : null;
}

export function selectedInspectTarget(target: InspectorTargetType | null): InspectSelectionType | null {
  return isInspectSelectionTarget(target) ? target : null;
}

export function isSameToolTarget(
  target: InspectorTargetType | ToolInspectorTargetType | null,
  name: string,
): boolean {
  return target !== null && target.variant === 'tool' && target.name === name;
}
