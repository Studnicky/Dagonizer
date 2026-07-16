export type LegendSwatchType = 'solid' | 'dashed' | 'square' | 'circle';

export type LegendItemType = {
  readonly 'key': string;
  readonly 'swatch': LegendSwatchType;
  readonly 'color': string;
  readonly 'label': string;
  readonly 'active'?: boolean;
};

export type LegendSectionType = {
  readonly 'key': string;
  readonly 'label': string;
  readonly 'entries': readonly LegendItemType[];
};

type LegendHooksType = {
  'getSections': () => readonly LegendSectionType[];
  'toggle'?: (key: string) => void;
};

type LegendStateType = {
  readonly 'sections': readonly LegendSectionType[];
};

export class LegendMachine {
  readonly #hooks: LegendHooksType;

  constructor(hooks: LegendHooksType) {
    this.#hooks = hooks;
  }

  state(): LegendStateType {
    return { 'sections': this.#hooks.getSections() };
  }

  isToggleable(item: LegendItemType): boolean {
    return item.active !== undefined && this.#hooks.toggle !== undefined;
  }

  toggle(key: string): void {
    this.#hooks.toggle?.(key);
  }
}
