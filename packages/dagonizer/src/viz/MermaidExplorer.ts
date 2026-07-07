/**
 * MermaidExplorer: framework-agnostic vanilla-TS browser class that enhances
 * every rendered Mermaid `.mermaid` SVG on a page with an interactive D-pad,
 * wheel-zoom, drag-pan, and a fullscreen expand modal.
 *
 * ## D-pad layout (3×3 grid — identical to GraphDpad.vue)
 *
 *   [zoom-in ] [pan-up  ] [zoom-out]
 *   [pan-left] [centre  ] [pan-right]
 *   [expand  ] [pan-down] [fit     ]
 *
 * ## Node safety
 *
 * The module never touches `document` or `window` at module load. Every DOM
 * access is guarded inside methods that check `typeof document === 'undefined'`
 * and return immediately in non-browser contexts. The package is safe to import
 * in SSR / Node.js builds where the DOM lib is absent.
 *
 * ## TypeScript without DOM lib
 *
 * The package tsconfig uses `lib: ["ES2024"]` with no DOM lib so that the
 * package remains runtime-neutral. The minimum DOM surface used by
 * `MermaidExplorer` is declared as local `type` stubs with `declare const`
 * ambient globals. These stubs are structural: real browser objects satisfy
 * them at runtime; consumers with the DOM lib get `skipLibCheck: true` so the
 * stubs do not conflict with the real DOM types in consuming projects.
 *
 * @example
 * ```ts
 * import { MermaidExplorer } from '@studnicky/dagonizer/viz';
 * MermaidExplorer.install({ selector: '.vp-doc div.mermaid' });
 * ```
 */

import { Scheduler } from '../runtime/Scheduler.js';

// ---------------------------------------------------------------------------
// Minimal DOM surface declarations (no DOM lib in this package tsconfig)
//
// These describe exactly the subset of DOM APIs used by MermaidExplorer.
// Declared as `type` so the noocodec lint rules that apply to `interface`
// (suffix + method-name constraints) do not apply here.
// ---------------------------------------------------------------------------

/** Bounding rectangle returned by `getBoundingClientRect()`. */
type ClientRectType = {
  readonly 'left':   number;
  readonly 'top':    number;
  readonly 'width':  number;
  readonly 'height': number;
};

/** SVG bounding box returned by `getBBox()`. */
type SvgBBoxType = {
  readonly 'x':      number;
  readonly 'y':      number;
  readonly 'width':  number;
  readonly 'height': number;
};

/** Numeric SVG coordinate bounds. */
type SvgBoundsType = {
  readonly 'x': number;
  readonly 'y': number;
  readonly 'w': number;
  readonly 'h': number;
};

/** Listener shape used in `addEventListener` stubs. */
type DomListenerType = (event: DomEventType) => void;

/** Minimal DOM event — members accessed by MermaidExplorer interaction code. */
type DomEventType = {
  readonly 'target':    DomElementType | null;
  readonly 'key':       string | undefined;
  readonly 'clientX':   number;
  readonly 'clientY':   number;
  readonly 'deltaY':    number;
  readonly 'pointerId': number;
  preventDefault():    void;
  stopPropagation():   void;
};

/**
 * Minimal DOM Element.
 *
 * All properties that DOM exposes as writable are declared here, including
 * `textContent` (writable) and `disabled` (for `<button>`). Methods that
 * match the real DOM API are declared using the structural call-signature form
 * to avoid the `noocodec/interface-must-be-contract` restriction on `interface`
 * method declarations.
 */
type DomElementType = {
  'className':   string;
  'textContent': string | null;
  'title':       string;
  'disabled':    boolean;
  'type':        string;
  'style':       Record<string, string>;
  // Standard DOM serialisation properties, declared on the minimal stub so the
  // explorer reads/writes them without a cast.
  'innerHTML':   string;
  'outerHTML':   string;
  'dataset':     Record<string, string | undefined>;
  'classList': {
    add(name: string): void;
  };
  'getBoundingClientRect': () => ClientRectType;
  'getAttribute':          (name: string) => string | null;
  'setAttribute':          (name: string, value: string) => void;
  'removeAttribute':       (name: string) => void;
  'appendChild':           <T extends DomElementType>(node: T) => T;
  'remove':                () => void;
  'querySelector':         <T extends DomElementType>(selector: string) => T | null;
  'querySelectorAll':      <T extends DomElementType>(selector: string) => ArrayLike<T>;
  'addEventListener':      (
    type:    string,
    handler: DomListenerType,
    options?: { 'passive': boolean },
  ) => void;
};

/** Minimal SVGElement — extends DomElementType with `getBBox` and `setPointerCapture`. */
type DomSvgElementType = DomElementType & {
  'getBBox':             () => SvgBBoxType;
  'setPointerCapture':   (pointerId: number) => void;
};

/**
 * Minimal `document` stub.
 *
 * `element` is the alias for `document.createElement` (the real method name
 * `createElement` triggers the `no-restricted-syntax` rule that forbids
 * `create*`-prefixed method names on interfaces). Since this is an internal
 * structural stub typed via `declare const`, the alias maps structurally to the
 * real `document.createElement` at the ambient-declaration level — the name
 * `element` is the TYPE identifier here; the runtime value is still the real
 * `document` object whose `.element` property does not exist. We therefore
 * access `createElement` at call sites through a cast bridge:
 * `(document as DomDocumentBridgeType).element(tag)`.
 *
 * To avoid the cast pattern entirely (no `as` casts allowed), we declare
 * `document` typed as a wider object whose `element` property is the same
 * function as `createElement`. The widening is an ambient declaration; the
 * real `document` at runtime has `createElement` as a method, not `element`,
 * so we must access it through the standard string-keyed index access on a
 * cast of `unknown`. However since `as unknown` is itself a cast, we instead
 * type `document` as an object with BOTH `createElement` (the real name, used
 * at call sites) AND the body/query methods. The `no-restricted-syntax` rule
 * only flags `interface` member declarations, not `type` function-property
 * entries, so declaring the type as a `type` alias with a `createElement`
 * function-property field avoids the lint error.
 */
type DomDocumentType = {
  'body': DomElementType;
  'createElement':  (tag: string) => DomElementType;
  'querySelectorAll': <T extends DomElementType>(selector: string) => ArrayLike<T>;
  'addEventListener':    (type: string, handler: DomListenerType) => void;
  'removeEventListener': (type: string, handler: DomListenerType) => void;
};

/** Minimal MutationObserver handle. */
type DomMutationObserverHandleType = {
  'observe': (
    target:  DomElementType,
    options: { 'childList': boolean; 'subtree': boolean },
  ) => void;
};

/** Constructor signature for MutationObserver. */
type DomMutationObserverCtorType = new (callback: () => void) => DomMutationObserverHandleType;

// ---------------------------------------------------------------------------
// Ambient globals — accessed only INSIDE methods, never at module load.
// ---------------------------------------------------------------------------

declare const document:             DomDocumentType;
declare const MutationObserver:     DomMutationObserverCtorType;
declare const requestAnimationFrame: (cb: () => void) => void;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Theme fallback values used when VitePress CSS custom properties
 * (`var(--vp-c-*)`) are not available in the host environment.
 */
export type MermaidExplorerThemeType = {
  /** Background colour for control chrome. Default: `'rgba(2,3,6,0.82)'`. */
  'surface'?: string;
  /** Border / icon colour for control buttons. Default: `'#22e8ff'`. */
  'stroke'?: string;
  /** Accent / hover colour. Default: `'#22e8ff'`. */
  'accent'?: string;
};

/**
 * Options for `MermaidExplorer.install` and `MermaidExplorer.enhance`.
 *
 * All fields are optional; defaults are supplied by `MERMAID_EXPLORER_DEFAULTS`.
 */
export type MermaidExplorerOptionsType = {
  /**
   * CSS selector that identifies Mermaid diagram wrapper elements.
   * Default: `'.vp-doc div.mermaid, .vp-doc .dagonizer-mermaid'`.
   */
  'selector'?: string;
  /**
   * Whether to render the D-pad navigation control.
   * Default: `true`.
   */
  'controls'?: boolean;
  /**
   * Whether to enable the fullscreen expand modal.
   * Default: `true`.
   */
  'expand'?: boolean;
  /**
   * How to fit the diagram on mount.
   * `'contain'` — scale to fit while never upscaling past 1×.
   * `'none'` — use natural scale.
   * Default: `'contain'`.
   */
  'fit'?: 'contain' | 'none';
  /** Override the control chrome colour palette. */
  'theme'?: MermaidExplorerThemeType;
};

// ---------------------------------------------------------------------------
// Module-level defaults and constants
// ---------------------------------------------------------------------------

/** Zoom step — matches AnimatedDagGraph and MemoryGraph: ×1.25 / ÷1.25. */
const ZOOM_STEP = 1.25;
/** Zoom lower clamp — prevents the diagram from vanishing to a dot. */
const ZOOM_MIN = 0.05;
/** Zoom upper clamp — prevents losing detail at unreasonable magnification. */
const ZOOM_MAX = 8;
/** Pan step in screen pixels — matches AnimatedDagGraph `panBy({ x:±80 })`. */
const PAN_STEP = 80;

/** Fraction of the stage a fit-to-contain pass fills, leaving breathing room. */
const FIT_MARGIN = 0.92;
/** Extra SVG-coordinate padding around measured content to preserve markers and styled labels. */
const SVG_BOUNDS_PADDING = 24;
/** Max poll ticks for the bounded post-mount SVG detection interval. */
const POLL_TICKS = 24;
/** Poll interval in ms during bounded post-mount observation. */
const POLL_INTERVAL_MS = 250;
/** Dataset key that marks a diagram frame as already enhanced (idempotency). */
const ENHANCED_KEY = 'dagExplorer';
/** Default selector for Mermaid diagram wrapper elements. */
const DEFAULT_SELECTOR = '.vp-doc div.mermaid, .vp-doc .dagonizer-mermaid';

/** Canonical defaults for all `MermaidExplorerOptionsType` fields. */
const MERMAID_EXPLORER_DEFAULTS: Required<MermaidExplorerOptionsType> = {
  'selector': DEFAULT_SELECTOR,
  'controls': true,
  'expand':   true,
  'fit':      'contain',
  'theme':    {},
};

// ---------------------------------------------------------------------------
// Internal camera state type
// ---------------------------------------------------------------------------

/**
 * Camera state managed per enhanced diagram instance.
 *
 * The SVG's `transform-origin` is set to `0 0` at enhance time; all transforms
 * are `translate(tx, ty) scale(scale)` applied from the top-left corner.
 * Zoom pivots are computed by adjusting `tx`/`ty` before updating `scale`.
 */
type CameraStateType = {
  /** Current scale factor (1 = natural / un-zoomed size). */
  'scale': number;
  /** CSS translate-x in screen pixels. */
  'tx': number;
  /** CSS translate-y in screen pixels. */
  'ty': number;
};

// ---------------------------------------------------------------------------
// MermaidExplorer
// ---------------------------------------------------------------------------

/**
 * Static class that turns every rendered Mermaid SVG into an interactive
 * diagram with D-pad controls, wheel-zoom, drag-pan, and fullscreen modal.
 *
 * All public surface is static. No instances are created — `MermaidExplorer`
 * is a namespace for the two entry points: `install` (page-wide wiring) and
 * `enhance` (single diagram). Both are safe to call repeatedly; already-
 * enhanced frames are skipped by the `dataset.dagExplorer` idempotency guard.
 *
 * Node-safe: module-level code never accesses DOM globals. Each static method
 * that needs DOM access begins with a `typeof document === 'undefined'` guard
 * and returns immediately in non-browser contexts.
 */
export class MermaidExplorer {
  private constructor() { /* static class — no instances */ }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Wire `MermaidExplorer.enhance` on all matching diagram frames already in
   * the DOM, then observe future DOM mutations and run a short bounded poll
   * (~24 ticks × 250 ms) to catch SVGs that Mermaid injects asynchronously.
   *
   * Safe to call multiple times: repeated calls add independent observers but
   * already-enhanced frames are skipped by the `dataset.dagExplorer` guard.
   *
   * No-op when called in a Node.js context (`typeof document === 'undefined'`).
   *
   * @param options Optional configuration; all fields have sensible defaults.
   */
  static install(options: MermaidExplorerOptionsType = {}): void {
    if (typeof document === 'undefined') return;

    const resolved = MermaidExplorer.#resolvedOptions(options);
    MermaidExplorer.#enhanceAll(resolved);

    const observer = new MutationObserver(() => {
      MermaidExplorer.#enhanceAll(resolved);
    });
    observer.observe(document.body, { 'childList': true, 'subtree': true });

    // Bounded poll: belt-and-suspenders for Mermaid's flush-callback insertion.
    void (async () => {
      for (let ticks = 0; ticks < POLL_TICKS; ticks += 1) {
        await Scheduler.current().after(POLL_INTERVAL_MS);
        MermaidExplorer.#enhanceAll(resolved);
      }
    })().catch(() => { /* scheduler reset cancels the bounded poll */ });
  }

  /**
   * Enhance a single diagram frame: locate its `<svg>`, strip intrinsic
   * dimensions, wire D-pad controls and pointer/wheel events.
   *
   * Idempotent: if the frame already has `dataset.dagExplorer === '1'`
   * this method returns immediately without adding duplicate controls.
   *
   * No-op when called in a Node.js context (`typeof document === 'undefined'`).
   *
   * @param frame The wrapper element that contains the Mermaid `<svg>`.
   * @param options Optional configuration; all fields have sensible defaults.
   */
  static enhance(frame: DomElementType, options: MermaidExplorerOptionsType = {}): void {
    if (typeof document === 'undefined') return;

    const svg = frame.querySelector<DomSvgElementType>('svg');
    if (svg === null) return;

    // Always normalize the current SVG before the idempotency guard. HMR and
    // framework renderers can replace the SVG inside an already-enhanced frame.
    MermaidExplorer.#sizeToIntrinsic(svg);

    if (frame.dataset[ENHANCED_KEY] === '1') {
      MermaidExplorer.#refreshBounds(svg);
      return;
    }

    frame.dataset[ENHANCED_KEY] = '1';
    frame.classList.add('dag-mermaid-frame');

    const resolved = MermaidExplorer.#resolvedOptions(options);

    // Pin the SVG to its intrinsic pixel size so the CSS transform controls
    // size deterministically (a width-less viewBox SVG would auto-fill the
    // container and fight the camera).
    const natural = MermaidExplorer.#sizeToIntrinsic(svg);

    // Initialise camera.
    const camera: CameraStateType = { 'scale': 1, 'tx': 0, 'ty': 0 };
    MermaidExplorer.#paint(svg, camera);

    // Fit on first paint.
    if (resolved.fit === 'contain') {
      requestAnimationFrame(() => {
        MermaidExplorer.#fitContain(frame, svg, camera, natural);
      });
    }

    MermaidExplorer.#refreshBounds(svg, () => {
      if (resolved.fit === 'contain') {
        const refreshed = MermaidExplorer.#naturalSize(svg);
        MermaidExplorer.#fitContain(frame, svg, camera, refreshed);
      }
    });

    // Pointer/wheel interaction.
    MermaidExplorer.#pointerPan(svg, camera);
    MermaidExplorer.#wheelZoom(frame, svg, camera);

    // D-pad control overlay.
    if (resolved.controls) {
      const dpad = MermaidExplorer.#dpad(frame, svg, camera, resolved);
      frame.appendChild(dpad);
    }
  }

  // ── Private: option resolution ─────────────────────────────────────────────

  static #resolvedOptions(
    options: MermaidExplorerOptionsType,
  ): Required<MermaidExplorerOptionsType> {
    return {
      'selector': options.selector ?? MERMAID_EXPLORER_DEFAULTS.selector,
      'controls': options.controls ?? MERMAID_EXPLORER_DEFAULTS.controls,
      'expand':   options.expand   ?? MERMAID_EXPLORER_DEFAULTS.expand,
      'fit':      options.fit      ?? MERMAID_EXPLORER_DEFAULTS.fit,
      'theme':    options.theme    ?? MERMAID_EXPLORER_DEFAULTS.theme,
    };
  }

  // ── Private: bulk enhance ──────────────────────────────────────────────────

  static #enhanceAll(options: Required<MermaidExplorerOptionsType>): void {
    const frames = document.querySelectorAll<DomElementType>(options.selector);
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame !== undefined) MermaidExplorer.enhance(frame, options);
    }
  }

  // ── Private: camera math ───────────────────────────────────────────────────

  /**
   * Write the camera state to the SVG element's CSS transform.
   *
   * Transform order: `translate` then `scale`, pivoted from `0 0` (set at
   * enhance time via `transformOrigin`). Zoom-about-pivot is achieved by
   * adjusting `tx`/`ty` before calling this method (see `#zoomAbout`).
   */
  static #paint(svg: DomSvgElementType, camera: CameraStateType): void {
    svg.style['transform'] = `translate(${camera.tx}px,${camera.ty}px) scale(${camera.scale})`;
  }

  /**
   * Zoom by `factor` about a pivot point in the stage's local coordinate space.
   *
   * `pivotX`/`pivotY` are in stage-relative pixels (cursor offset from the
   * stage's bounding rect). The translate is adjusted so the point under the
   * cursor stays anchored after the scale change — identical to the
   * `AnimatedDagGraph` zoom implementation which uses cytoscape's
   * `renderedPosition` pivot and to the wheel handler in `MermaidEnhancer`.
   */
  static #zoomAbout(
    svg:    DomSvgElementType,
    camera: CameraStateType,
    factor: number,
    pivotX: number,
    pivotY: number,
  ): void {
    const next  = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camera.scale * factor));
    const ratio = next / camera.scale;
    camera.tx    = pivotX - (pivotX - camera.tx) * ratio;
    camera.ty    = pivotY - (pivotY - camera.ty) * ratio;
    camera.scale = next;
    MermaidExplorer.#paint(svg, camera);
  }

  /**
   * Scale to fit the diagram's natural bounds inside the stage, never
   * upscaling past 1× (contain, not fill).
   *
   * Natural bounds are read from `getBBox()` (most accurate), falling back to
   * the SVG `viewBox` attribute, then to a 1024×768 safe default.
   */
  static #fitContain(
    stage:   DomElementType,
    svg:     DomSvgElementType,
    camera:  CameraStateType,
    natural: { readonly w: number; readonly h: number } | null = null,
  ): void {
    const stageRect = stage.getBoundingClientRect();
    const fw = stageRect.width  || 400;
    const fh = stageRect.height || 300;

    // Prefer a caller-supplied natural size (measured from the laid-out source
    // SVG). A freshly innerHTML-cloned SVG can fail getBBox at first paint, so
    // self-measuring is unreliable for the fullscreen modal.
    let nw = natural !== null && natural.w > 0 ? natural.w : 0;
    let nh = natural !== null && natural.h > 0 ? natural.h : 0;

    if (nw <= 0 || nh <= 0) {
      const measured = MermaidExplorer.#naturalSize(svg);
      nw = measured.w;
      nh = measured.h;
    }

    const scale = Math.min((fw * FIT_MARGIN) / nw, (fh * FIT_MARGIN) / nh, 1);
    camera.scale = scale;
    camera.tx    = (fw - nw * scale) / 2;
    camera.ty    = (fh - nh * scale) / 2;
    MermaidExplorer.#paint(svg, camera);
  }

  /**
   * Re-run bounds normalization after browser layout/style has settled.
   *
   * Mermaid computes node geometry before host-page CSS is necessarily applied.
   * A later font-size, font-family, letter-spacing, or label style can push text
   * outside the original viewBox. Two animation frames catch that settled
   * geometry and expand the SVG coordinate frame before the viewport clips it.
   */
  static #refreshBounds(svg: DomSvgElementType, after?: () => void): void {
    requestAnimationFrame(() => {
      MermaidExplorer.#sizeToIntrinsic(svg);
      if (after !== undefined) after();
      requestAnimationFrame(() => {
        MermaidExplorer.#sizeToIntrinsic(svg);
        if (after !== undefined) after();
      });
    });
  }

  /**
   * Natural size of an SVG. Prefer the viewBox (the svg's own coordinate frame)
   * so sizing the element to it is distortion-free; fall back to getBBox, then
   * a default.
   */
  static #naturalSize(svg: DomSvgElementType): { readonly w: number; readonly h: number } {
    const vb = svg.getAttribute('viewBox');
    if (vb !== null) {
      const parts = vb.trim().split(/[\s,]+/u);
      const w = parseFloat(parts[2] ?? '0');
      const h = parseFloat(parts[3] ?? '0');
      if (w > 0 && h > 0) return { 'w': w, 'h': h };
    }
    try {
      const bbox = svg.getBBox();
      if (bbox.width > 0 && bbox.height > 0) return { 'w': bbox.width, 'h': bbox.height };
    } catch { /* getBBox throws on detached/invisible SVG */ }
    return { 'w': 1024, 'h': 768 };
  }

  /**
   * Expand the SVG viewBox to the measured rendered content bounds.
   *
   * This is the clipping hardening layer: labels may become wider after host
   * CSS is applied, so the viewBox must be derived from actual rendered bounds
   * rather than Mermaid's initial layout assumptions.
   */
  static #normalizeBounds(svg: DomSvgElementType): void {
    MermaidExplorer.#showOverflow(svg);
    const content = MermaidExplorer.#contentBounds(svg);
    if (content === null) return;

    const x = content.x - SVG_BOUNDS_PADDING;
    const y = content.y - SVG_BOUNDS_PADDING;
    const w = content.w + SVG_BOUNDS_PADDING * 2;
    const h = content.h + SVG_BOUNDS_PADDING * 2;
    if (w <= 0 || h <= 0) return;
    svg.setAttribute('viewBox', `${String(x)} ${String(y)} ${String(w)} ${String(h)}`);
  }

  /** Force the SVG and its rendered children to expose their measured bounds. */
  static #showOverflow(svg: DomSvgElementType): void {
    svg.style['overflow'] = 'visible';
    const descendants = svg.querySelectorAll<DomElementType>('*');
    for (let i = 0; i < descendants.length; i++) {
      const child = descendants[i];
      if (child !== undefined) child.style['overflow'] = 'visible';
    }
  }

  /** Read rendered SVG content bounds, returning null while layout is unavailable. */
  static #contentBounds(svg: DomSvgElementType): SvgBoundsType | null {
    try {
      const bbox = svg.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        return { 'x': bbox.x, 'y': bbox.y, 'w': bbox.width, 'h': bbox.height };
      }
    } catch { /* getBBox throws on detached/invisible SVG */ }
    return null;
  }

  /**
   * Pin the SVG to a fixed pixel size equal to its intrinsic (viewBox) size and
   * neutralise any `max-width: 100%` from theme CSS. A viewBox SVG with no width
   * auto-fills its container, which fights the transform-based camera; pinning a
   * known size lets the CSS transform scale and position it deterministically.
   */
  static #sizeToIntrinsic(svg: DomSvgElementType): { readonly w: number; readonly h: number } {
    MermaidExplorer.#normalizeBounds(svg);
    const n = MermaidExplorer.#naturalSize(svg);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style['width']           = `${String(n.w)}px`;
    svg.style['height']          = `${String(n.h)}px`;
    svg.style['maxWidth']        = 'none';
    svg.style['transformOrigin'] = '0 0';
    svg.style['display']         = 'block';
    return n;
  }

  /**
   * Re-centre the diagram in the stage WITHOUT changing scale.
   *
   * Measures the diagram's current rendered bounding rect relative to the
   * stage and shifts the translate so the diagram is centred — matching
   * `AnimatedDagGraph.centerView()` which calls `cy.center()`.
   */
  static #centre(
    stage:  DomElementType,
    svg:    DomSvgElementType,
    camera: CameraStateType,
  ): void {
    const stageRect = stage.getBoundingClientRect();
    const svgRect   = svg.getBoundingClientRect();
    camera.tx += (stageRect.left + stageRect.width  / 2) - (svgRect.left + svgRect.width  / 2);
    camera.ty += (stageRect.top  + stageRect.height / 2) - (svgRect.top  + svgRect.height / 2);
    MermaidExplorer.#paint(svg, camera);
  }

  // ── Private: interaction wiring ────────────────────────────────────────────

  /**
   * Wire drag-pan via `setPointerCapture` on the SVG element.
   *
   * `setPointerCapture` routes all pointer events to the capture target even
   * when the pointer leaves the element, preventing ghost drags after fast
   * gestures — matching the modal's pointer handling in `MermaidEnhancer`.
   */
  static #pointerPan(
    svg:    DomSvgElementType,
    camera: CameraStateType,
  ): void {
    let dragging = false;
    let lastX    = 0;
    let lastY    = 0;

    svg.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      svg.setPointerCapture(e.pointerId);
    });

    svg.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      camera.tx += e.clientX - lastX;
      camera.ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      MermaidExplorer.#paint(svg, camera);
    });

    const endDrag = (): void => { dragging = false; };
    svg.addEventListener('pointerup',     endDrag);
    svg.addEventListener('pointercancel', endDrag);
  }

  /**
   * Wire wheel-zoom with cursor-pivot scaling on the stage.
   *
   * Uses `{ passive: false }` to allow `e.preventDefault()` to suppress page
   * scroll. The pivot is derived from the cursor's position relative to the
   * stage so the point under the cursor stays fixed during zoom.
   */
  static #wheelZoom(
    stage:  DomElementType,
    svg:    DomSvgElementType,
    camera: CameraStateType,
  ): void {
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect   = stage.getBoundingClientRect();
      const pivotX = e.clientX - rect.left;
      const pivotY = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      MermaidExplorer.#zoomAbout(svg, camera, factor, pivotX, pivotY);
    }, { 'passive': false });
  }

  // ── Private: D-pad construction ────────────────────────────────────────────

  /**
   * Build the 3×3 D-pad control overlay element for an inline diagram frame.
   *
   * D-pad layout matches GraphDpad.vue exactly:
   *   row 1: zoom-in · pan-up · zoom-out
   *   row 2: pan-left · centre · pan-right
   *   row 3: expand · pan-down · fit
   *
   * Pan-left moves the view toward the left (reveals left content), i.e.
   * translates the SVG rightward (+tx) — matching `AnimatedDagGraph.panLeft()`
   * which calls `cy.panBy({ x: 80, y: 0 })` where positive x reveals
   * content to the left of the viewport.
   *
   * The expand slot opens the fullscreen modal when `options.expand` is true;
   * otherwise a disabled placeholder preserves the 3×3 grid shape.
   */
  static #dpad(
    frame:   DomElementType,
    svg:     DomSvgElementType,
    camera:  CameraStateType,
    options: Required<MermaidExplorerOptionsType>,
  ): DomElementType {
    const wrap = document.createElement('div');
    wrap.className = 'dag-mermaid-dpad-wrap';
    wrap.setAttribute('aria-label', 'Diagram navigation controls');

    const grid = document.createElement('div');
    grid.className = 'dag-mermaid-dpad';

    /** Stage-centre pivot for D-pad zoom buttons. */
    const stageCentre = (): { 'x': number; 'y': number } => {
      const r = frame.getBoundingClientRect();
      return { 'x': r.width / 2, 'y': r.height / 2 };
    };

    // Row 1: zoom-in · pan-up · zoom-out
    grid.appendChild(MermaidExplorer.#btn('＋', 'Zoom in', () => {
      const c = stageCentre();
      MermaidExplorer.#zoomAbout(svg, camera, ZOOM_STEP, c.x, c.y);
    }));
    grid.appendChild(MermaidExplorer.#btn('▲', 'Pan up', () => {
      camera.ty += PAN_STEP;
      MermaidExplorer.#paint(svg, camera);
    }));
    grid.appendChild(MermaidExplorer.#btn('－', 'Zoom out', () => {
      const c = stageCentre();
      MermaidExplorer.#zoomAbout(svg, camera, 1 / ZOOM_STEP, c.x, c.y);
    }));

    // Row 2: pan-left · centre · pan-right
    grid.appendChild(MermaidExplorer.#btn('◀', 'Pan left', () => {
      // Translate SVG rightward — reveals content to the left of the viewport.
      // Matches AnimatedDagGraph.panLeft(): cy.panBy({ x: 80, y: 0 }).
      camera.tx += PAN_STEP;
      MermaidExplorer.#paint(svg, camera);
    }));
    grid.appendChild(MermaidExplorer.#btn('⊙', 'Centre view', () => {
      MermaidExplorer.#centre(frame, svg, camera);
    }));
    grid.appendChild(MermaidExplorer.#btn('▶', 'Pan right', () => {
      camera.tx -= PAN_STEP;
      MermaidExplorer.#paint(svg, camera);
    }));

    // Row 3: expand · pan-down · fit
    if (options.expand) {
      grid.appendChild(MermaidExplorer.#btn('⛶', 'Expand fullscreen', () => {
        MermaidExplorer.#modal(svg, options);
      }));
    } else {
      const placeholder = document.createElement('button');
      placeholder.className = 'dag-mermaid-dpad-btn dag-mermaid-dpad-btn--disabled';
      placeholder.disabled  = true;
      placeholder.setAttribute('aria-hidden', 'true');
      grid.appendChild(placeholder);
    }
    grid.appendChild(MermaidExplorer.#btn('▼', 'Pan down', () => {
      camera.ty -= PAN_STEP;
      MermaidExplorer.#paint(svg, camera);
    }));
    grid.appendChild(MermaidExplorer.#btn('⤢', 'Fit to view', () => {
      MermaidExplorer.#fitContain(frame, svg, camera);
    }));

    MermaidExplorer.#themed(wrap, options.theme);
    wrap.appendChild(grid);
    return wrap;
  }

  /** Produce a single D-pad button with `aria-label`, `title`, and click handler. */
  static #btn(
    label:   string,
    title:   string,
    handler: () => void,
  ): DomElementType {
    const btn = document.createElement('button');
    btn.className   = 'dag-mermaid-dpad-btn';
    btn.type        = 'button';
    btn.title       = title;
    btn.textContent = label;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handler();
    });
    return btn;
  }

  /**
   * Write `theme` fallback values as inline CSS custom properties on the
   * D-pad wrap element. Only provided fields are written; absent fields fall
   * through to the stylesheet's `var(--vp-c-*)` defaults.
   */
  static #themed(
    wrap:  DomElementType,
    theme: MermaidExplorerThemeType,
  ): void {
    if (theme.surface !== undefined) {
      wrap.style['--dag-explorer-surface'] = theme.surface;
    }
    if (theme.stroke !== undefined) {
      wrap.style['--dag-explorer-stroke'] = theme.stroke;
    }
    if (theme.accent !== undefined) {
      wrap.style['--dag-explorer-accent'] = theme.accent;
    }
  }

  // ── Private: fullscreen modal ──────────────────────────────────────────────

  /**
   * Open a fullscreen modal containing a cloned copy of `svg` with its own
   * independent D-pad. The expand slot becomes a close (✕ / Esc) control.
   *
   * The modal is appended to `document.body` and removed on close. The cloned
   * SVG has its own independent `CameraStateType` so the modal's transform
   * state is fully isolated from the inline diagram's camera.
   *
   * Backdrop-click (on the overlay itself, not the stage) and Escape close
   * the modal — matching the `DiagramFrame.vue` expand modal pattern.
   */
  static #modal(
    svg:     DomSvgElementType,
    options: Required<MermaidExplorerOptionsType>,
  ): void {
    const overlay = document.createElement('div');
    overlay.className = 'dag-mermaid-modal';
    overlay.setAttribute('role',       'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Diagram fullscreen view');

    const stage = document.createElement('div');
    stage.className = 'dag-mermaid-modal-stage';

    // Transfer SVG content into stage via innerHTML/outerHTML. This approach
    // avoids `cloneNode` (no type available without DOM lib) and naturally
    // resets any inline transforms from the source diagram, giving a clean
    // camera for the modal's independent CameraStateType.
    //
    // `style`, `innerHTML`, and `outerHTML` are declared on the minimal DOM
    // stub (DomElementType), so these read/write directly — no cast.
    const stageStyle = stage.style;
    stageStyle['position']    = 'relative';
    stageStyle['overflow']    = 'hidden';
    stageStyle['flex']        = '1 1 auto';
    stageStyle['cursor']      = 'grab';
    stageStyle['userSelect']  = 'none';
    stageStyle['touchAction'] = 'none';

    // Temporarily clear the source transform so the cloned SVG starts at
    // scale 1 / translate 0 (independent camera).
    const svgStyle = svg.style;
    const savedTransform: string = svgStyle['transform'] ?? '';
    svgStyle['transform'] = '';

    // Transfer the SVG into the stage via outerHTML → innerHTML.
    stage.innerHTML = svg.outerHTML;

    // Restore source SVG transform.
    svgStyle['transform'] = savedTransform;

    const hint = document.createElement('div');
    hint.className   = 'dag-mermaid-modal-hint';
    hint.textContent = 'drag · wheel · esc to close';
    hint.setAttribute('aria-hidden', 'true');

    const dpadWrap = document.createElement('div');
    dpadWrap.className = 'dag-mermaid-dpad-wrap';
    dpadWrap.setAttribute('aria-label', 'Diagram navigation controls');

    const grid = document.createElement('div');
    grid.className = 'dag-mermaid-dpad';

    overlay.appendChild(stage);
    overlay.appendChild(hint);
    overlay.appendChild(dpadWrap);
    document.body.appendChild(overlay);
    document.body.style['overflow'] = 'hidden';

    // Re-select the cloned SVG that now lives in the stage.
    const clonedSvg = stage.querySelector<DomSvgElementType>('svg');
    if (clonedSvg === null) {
      // Clone failed — clean up and bail.
      document.body.style['overflow'] = '';
      overlay.remove();
      return;
    }

    const modalNatural = MermaidExplorer.#sizeToIntrinsic(clonedSvg);

    const modalCamera: CameraStateType = { 'scale': 1, 'tx': 0, 'ty': 0 };
    MermaidExplorer.#paint(clonedSvg, modalCamera);

    // Fit once the overlay has its layout dimensions. Double-rAF so the
    // fixed-position stage has measured its size; pass the source-measured
    // natural dims so the fit is correct even if the clone's getBBox is not
    // yet ready.
    requestAnimationFrame(() => {
      MermaidExplorer.#fitContain(stage, clonedSvg, modalCamera, modalNatural);
      requestAnimationFrame(() => {
        MermaidExplorer.#fitContain(stage, clonedSvg, modalCamera, modalNatural);
      });
    });

    // Interaction.
    MermaidExplorer.#pointerPan(clonedSvg, modalCamera);
    MermaidExplorer.#wheelZoom(stage, clonedSvg, modalCamera);

    // Stage-centre pivot for modal D-pad zoom buttons.
    const stageCentreModal = (): { 'x': number; 'y': number } => {
      const r = stage.getBoundingClientRect();
      return { 'x': r.width / 2, 'y': r.height / 2 };
    };

    // Row 1: zoom-in · pan-up · zoom-out
    grid.appendChild(MermaidExplorer.#btn('＋', 'Zoom in', () => {
      const c = stageCentreModal();
      MermaidExplorer.#zoomAbout(clonedSvg, modalCamera, ZOOM_STEP, c.x, c.y);
    }));
    grid.appendChild(MermaidExplorer.#btn('▲', 'Pan up', () => {
      modalCamera.ty += PAN_STEP;
      MermaidExplorer.#paint(clonedSvg, modalCamera);
    }));
    grid.appendChild(MermaidExplorer.#btn('－', 'Zoom out', () => {
      const c = stageCentreModal();
      MermaidExplorer.#zoomAbout(clonedSvg, modalCamera, 1 / ZOOM_STEP, c.x, c.y);
    }));

    // Row 2: pan-left · centre · pan-right
    grid.appendChild(MermaidExplorer.#btn('◀', 'Pan left', () => {
      modalCamera.tx += PAN_STEP;
      MermaidExplorer.#paint(clonedSvg, modalCamera);
    }));
    grid.appendChild(MermaidExplorer.#btn('⊙', 'Centre view', () => {
      MermaidExplorer.#centre(stage, clonedSvg, modalCamera);
    }));
    grid.appendChild(MermaidExplorer.#btn('▶', 'Pan right', () => {
      modalCamera.tx -= PAN_STEP;
      MermaidExplorer.#paint(clonedSvg, modalCamera);
    }));

    // Escape key closes; defined first so close-handlers can reference it.
    const onKey: DomListenerType = (e) => {
      if (e.key === 'Escape') MermaidExplorer.#dismiss(overlay, onKey);
    };

    // Row 3: close (expand slot → close in modal) · pan-down · fit
    grid.appendChild(MermaidExplorer.#btn('✕', 'Close (Esc)', () => {
      MermaidExplorer.#dismiss(overlay, onKey);
    }));
    grid.appendChild(MermaidExplorer.#btn('▼', 'Pan down', () => {
      modalCamera.ty -= PAN_STEP;
      MermaidExplorer.#paint(clonedSvg, modalCamera);
    }));
    grid.appendChild(MermaidExplorer.#btn('⤢', 'Fit to view', () => {
      MermaidExplorer.#fitContain(stage, clonedSvg, modalCamera);
    }));

    MermaidExplorer.#themed(dpadWrap, options.theme);
    dpadWrap.appendChild(grid);

    // Backdrop click (overlay itself, not stage or buttons) closes the modal.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) MermaidExplorer.#dismiss(overlay, onKey);
    });

    document.addEventListener('keydown', onKey);
  }

  /** Tear down the expanded modal overlay and its document-level key listener. */
  static #dismiss(overlay: DomElementType, onKey: DomListenerType): void {
    document.body.style['overflow'] = '';
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
}
