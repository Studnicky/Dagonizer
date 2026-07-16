/**
 * Shared lifecycle controller for visualization modal/expanded shells.
 *
 * This owns the renderer-agnostic semantics:
 *
 * - open / close / toggle state;
 * - Escape dismissal;
 * - backdrop dismissal;
 * - state-change notifications for resize, scroll locking, focus, or teardown.
 *
 * Content rendering, fullscreen APIs, DOM structure, and backend-specific fit
 * behavior remain local to the consumer.
 */

export type ModalDismissReasonType = 'programmatic' | 'escape' | 'backdrop';

export type ModalControllerHooksType = {
  'onOpen'?: () => void;
  'onClose'?: (reason: ModalDismissReasonType) => void;
  'onStateChange'?: (open: boolean, reason: ModalDismissReasonType | null) => void;
};

export class ModalController {
  #open = false;
  readonly #hooks: ModalControllerHooksType;

  constructor(hooks: ModalControllerHooksType = {}) {
    this.#hooks = hooks;
  }

  isOpen(): boolean {
    return this.#open;
  }

  open(): boolean {
    if (this.#open) return false;
    this.#open = true;
    this.#hooks.onOpen?.();
    this.#hooks.onStateChange?.(true, null);
    return true;
  }

  close(reason: ModalDismissReasonType = 'programmatic'): boolean {
    if (!this.#open) return false;
    this.#open = false;
    this.#hooks.onClose?.(reason);
    this.#hooks.onStateChange?.(false, reason);
    return true;
  }

  toggle(): boolean {
    return this.#open ? this.close('programmatic') : this.open();
  }

  onKeyDown(key: string | undefined): boolean {
    if (key !== 'Escape') return false;
    return this.close('escape');
  }

  onBackdropPress(isBackdropTarget: boolean): boolean {
    if (!isBackdropTarget) return false;
    return this.close('backdrop');
  }
}
