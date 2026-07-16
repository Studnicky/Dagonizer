/**
 * Shared action descriptor model for visualization chrome.
 *
 * This is renderer-neutral metadata: identity, title, label, state, and tone.
 * Consumers choose where the actions appear (header, overlay, modal) and bind
 * handlers locally.
 */

export type ViewerActionToneType = 'default' | 'danger';
export type ViewerActionVariantType = 'header' | 'overlay';

export type ViewerActionIdType =
  | 'zoom-in'
  | 'zoom-out'
  | 'centre'
  | 'fit'
  | 'close'
  | 'expand'
  | 'fullscreen'
  | 'clear';

export type ViewerActionType = {
  readonly 'id': ViewerActionIdType;
  readonly 'label': string;
  readonly 'title': string;
  readonly 'ariaLabel'?: string;
  readonly 'pressed'?: boolean;
  readonly 'disabled'?: boolean;
  readonly 'tone'?: ViewerActionToneType;
  readonly 'shortcut'?: string;
};

export function viewerAction(
  id: ViewerActionIdType,
  overrides: Partial<Omit<ViewerActionType, 'id'>> = {},
): ViewerActionType {
  const base = VIEWER_ACTIONS[id];
  return {
    'id': id,
    'label': overrides.label ?? base.label,
    'title': overrides.title ?? base.title,
    ...(overrides.ariaLabel !== undefined ? { 'ariaLabel': overrides.ariaLabel } : base.ariaLabel !== undefined ? { 'ariaLabel': base.ariaLabel } : {}),
    ...(overrides.pressed !== undefined ? { 'pressed': overrides.pressed } : {}),
    ...(overrides.disabled !== undefined ? { 'disabled': overrides.disabled } : {}),
    ...(overrides.tone !== undefined ? { 'tone': overrides.tone } : base.tone !== undefined ? { 'tone': base.tone } : {}),
    ...(overrides.shortcut !== undefined ? { 'shortcut': overrides.shortcut } : base.shortcut !== undefined ? { 'shortcut': base.shortcut } : {}),
  };
}

const VIEWER_ACTIONS: Record<ViewerActionIdType, Omit<ViewerActionType, 'id'>> = {
  'zoom-in': {
    'label': '＋',
    'title': 'Zoom in',
  },
  'zoom-out': {
    'label': '－',
    'title': 'Zoom out',
  },
  'centre': {
    'label': '⊙',
    'title': 'Centre view',
  },
  'fit': {
    'label': '⤢',
    'title': 'Fit to view',
  },
  'close': {
    'label': '✕',
    'title': 'Close',
    'shortcut': 'Esc',
  },
  'expand': {
    'label': '⤢',
    'title': 'Expand',
  },
  'fullscreen': {
    'label': '⛶',
    'title': 'Fullscreen',
  },
  'clear': {
    'label': '🗑 clear',
    'title': 'Clear',
    'tone': 'danger',
  },
};
