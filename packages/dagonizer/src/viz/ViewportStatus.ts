export type ViewportModeType = 'inline' | 'modal';

export type ViewportStatusType = {
  readonly 'zoomLevel': number | null;
  readonly 'zoomText': string | null;
  readonly 'mode': ViewportModeType;
  readonly 'hint': string | null;
  readonly 'canPan': boolean;
  readonly 'canFit': boolean;
};

export type ViewportStatusOptionsType = {
  readonly 'zoomLevel': number | null;
  readonly 'mode': ViewportModeType;
  readonly 'hint'?: string | null;
  readonly 'canPan'?: boolean;
  readonly 'canFit'?: boolean;
  readonly 'formatZoom'?: (zoomLevel: number | null) => string | null;
};

export function createViewportStatus(
  zoomLevelOrOptions: number | null | ViewportStatusOptionsType,
  mode?: ViewportModeType,
  hint: string | null = 'drag · wheel',
): ViewportStatusType {
  const options = typeof zoomLevelOrOptions === 'object' && zoomLevelOrOptions !== null
    ? zoomLevelOrOptions
    : {
      'zoomLevel': zoomLevelOrOptions,
      'mode': mode ?? 'inline',
      hint,
    };
  const zoomLevel = options.zoomLevel;
  return {
    'zoomLevel': zoomLevel,
    'zoomText': options.formatZoom?.(zoomLevel) ?? (zoomLevel === null ? null : `${zoomLevel.toFixed(2)}×`),
    'mode': options.mode,
    'hint': options.hint ?? 'drag · wheel',
    'canPan': options.canPan ?? true,
    'canFit': options.canFit ?? true,
  };
}
