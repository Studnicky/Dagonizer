import { DpadMachine } from './DpadMachine.js';
import type { DpadActionType, DpadModeType } from './DpadMachine.js';

export type CameraPanDirectionType = 'up' | 'down' | 'left' | 'right';

export type CameraControlSurfaceType = {
  'can'?: (action: DpadActionType) => boolean;
  'zoomIn': () => void | Promise<void>;
  'zoomOut': () => void | Promise<void>;
  'pan': (direction: CameraPanDirectionType) => void | Promise<void>;
  'centre': () => void | Promise<void>;
  'fit': () => void | Promise<void>;
  'expand'?: () => void | Promise<void>;
  'close'?: () => void | Promise<void>;
  'getZoomLevel'?: () => number | null;
  'getZoomText'?: () => string | null;
  'getHint'?: () => string | null;
};

export function runCameraControlAction(
  controls: CameraControlSurfaceType,
  action: DpadActionType,
): void | Promise<void> {
  switch (action) {
    case 'zoom-in':   return controls.zoomIn();
    case 'zoom-out':  return controls.zoomOut();
    case 'pan-up':    return controls.pan('up');
    case 'pan-down':  return controls.pan('down');
    case 'pan-left':  return controls.pan('left');
    case 'pan-right': return controls.pan('right');
    case 'centre':    return controls.centre();
    case 'fit':       return controls.fit();
    case 'expand':    return controls.expand?.();
    case 'close':     return controls.close?.();
  }
}

export function createCameraDpadMachine(
  controls: CameraControlSurfaceType,
  mode: DpadModeType = 'inline',
): DpadMachine {
  const hooks: {
    'can': (action: DpadActionType) => boolean;
    'run': (action: DpadActionType) => void | Promise<void>;
    'getZoomLevel'?: () => number | null;
    'getZoomText'?: () => string | null;
    'getHint'?: () => string | null;
  } = {
    'can': (action: DpadActionType) => {
      if (controls.can?.(action) === false) return false;
      if (action === 'expand' && controls.expand === undefined) return false;
      if (action === 'close' && controls.close === undefined) return false;
      return true;
    },
    'run': (action: DpadActionType) => runCameraControlAction(controls, action),
  };
  if (controls.getZoomLevel !== undefined) hooks.getZoomLevel = controls.getZoomLevel;
  if (controls.getZoomText !== undefined) hooks.getZoomText = controls.getZoomText;
  if (controls.getHint !== undefined) hooks.getHint = controls.getHint;
  return new DpadMachine(hooks, mode);
}
