export type DpadActionType =
  | 'zoom-in'
  | 'pan-up'
  | 'zoom-out'
  | 'pan-left'
  | 'centre'
  | 'pan-right'
  | 'expand'
  | 'close'
  | 'pan-down'
  | 'fit';

export type DpadModeType = 'inline' | 'modal';

type DpadHooksType = {
  'can'?: (action: DpadActionType) => boolean;
  'run': (action: DpadActionType) => void | Promise<void>;
  'getZoomLevel'?: () => number | null;
  'getZoomText'?: () => string | null;
  'getHint'?: () => string | null;
};

type DpadItemType = {
  readonly 'action': DpadActionType;
  readonly 'label': string;
  readonly 'title': string;
  readonly 'disabled': boolean;
};

type DpadStateType = {
  readonly 'mode': DpadModeType;
  readonly 'zoomLevel': number | null;
  readonly 'zoomText': string | null;
  readonly 'hint': string | null;
  readonly 'items': readonly DpadItemType[];
};

const INLINE_GRID: readonly DpadActionType[] = [
  'zoom-in', 'pan-up', 'zoom-out',
  'pan-left', 'centre', 'pan-right',
  'expand', 'pan-down', 'fit',
];

const MODAL_GRID: readonly DpadActionType[] = [
  'zoom-in', 'pan-up', 'zoom-out',
  'pan-left', 'centre', 'pan-right',
  'close', 'pan-down', 'fit',
];

const META: Readonly<Record<DpadActionType, { readonly 'label': string; readonly 'title': string }>> = {
  'zoom-in':  { 'label': '＋', 'title': 'Zoom in' },
  'pan-up':   { 'label': '▲', 'title': 'Pan up' },
  'zoom-out': { 'label': '－', 'title': 'Zoom out' },
  'pan-left': { 'label': '◀', 'title': 'Pan left' },
  'centre':   { 'label': '⊙', 'title': 'Centre view' },
  'pan-right':{ 'label': '▶', 'title': 'Pan right' },
  'expand':   { 'label': '⛶', 'title': 'Expand fullscreen' },
  'close':    { 'label': '✕', 'title': 'Close (Esc)' },
  'pan-down': { 'label': '▼', 'title': 'Pan down' },
  'fit':      { 'label': '⤢', 'title': 'Fit to view' },
};

/**
 * Package-owned D-pad state machine.
 *
 * The machine owns:
 * - canonical button ordering and labels;
 * - inline vs modal lower-left slot behavior;
 * - disabled-state evaluation through capability hooks;
 * - zoom HUD state exposure.
 *
 * Visualizations supply only action hooks. They do not redefine the control.
 */
export class DpadMachine {
  readonly #hooks: DpadHooksType;

  #mode: DpadModeType;

  constructor(hooks: DpadHooksType, mode: DpadModeType = 'inline') {
    this.#hooks = hooks;
    this.#mode = mode;
  }

  setMode(mode: DpadModeType): void {
    this.#mode = mode;
  }

  state(): DpadStateType {
    const actions = this.#mode === 'modal' ? MODAL_GRID : INLINE_GRID;
    return {
      'mode': this.#mode,
      'zoomLevel': this.#hooks.getZoomLevel?.() ?? null,
      'zoomText': this.#hooks.getZoomText?.() ?? (() => {
        const level = this.#hooks.getZoomLevel?.() ?? null;
        return level === null ? null : `${level.toFixed(2)}×`;
      })(),
      'hint': this.#hooks.getHint?.() ?? 'drag · wheel',
      'items': actions.map((action) => ({
        'action': action,
        'label': META[action].label,
        'title': META[action].title,
        'disabled': this.#hooks.can?.(action) === false,
      })),
    };
  }

  async press(action: DpadActionType): Promise<void> {
    if (this.#hooks.can?.(action) === false) return;
    await this.#hooks.run(action);
  }
}
