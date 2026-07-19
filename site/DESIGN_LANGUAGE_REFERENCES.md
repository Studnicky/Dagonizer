# Hex-tech design language — reference notes

Consult this file before any shape/visual-language work on the site. It
tracks every reference the user has pointed to and the concrete technique
extracted from each, so direction isn't lost across a long session.

## Core rule

**Hexagons only. No octagons, no rounded corners, no bubbles.** But — a
regular hexagon (equal sides, equal 120° angles) has a FIXED width:height
ratio (≈1.1547:1 flat-top, or its reciprocal ≈0.866:1 pointy-top). It
cannot stretch to fit arbitrary-width content, so there are two distinct
element categories, not one shape applied everywhere:

1. **Fixed-size elements** (icon/glyph chips, the logo mount, hex-grid tile
   cells — anything whose box CAN be sized to the exact required ratio):
   get a true regular hexagon — equal sides, equal angles, `aspect-ratio`
   locked to the hexagon ratio. Class: `.hex-cell` in `global.css`
   (pointy-top: `aspect-ratio: 0.866`, `polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)`).
2. **Variable-width elements** (buttons with text, nav items, badges/tags
   with text, wide panels/cards with paragraph content — anything whose
   width must flex with its content): these are NOT hexagons. They stay
   plain rectangles. Forcing them into a fixed hexagon ratio would either
   clip the text or leave large empty gaps — that's a real geometric
   constraint, not a stylistic choice to fudge. Classes: `.hex-shell`/
   `.hex-tile`/`.hex-chrome`/`.hex-tag` in `global.css` — these keep the
   metallic `border-image` bezel but do NOT clip to any hexagon shape.

An earlier pass tried an "elongated hexagon" (flat top/bottom edges of
arbitrary length, angled points only at the ends) as a compromise for
variable-width elements — this is NOT a regular hexagon (unequal side
lengths/angles) and was rejected. Do not reintroduce it.

## Metallic effect placement

Metal (chrome/steel gradient sheen) belongs on **borders, dividers, and
icon containers** — things that are actually metal on the logo mark. It
must NEVER be applied to body or heading text via `background-clip: text`:
a background-clip gradient is positioned against the whole element's
bounding box, so on wrapped multi-line text each line gets an inconsistent,
arbitrary slice of the gradient rather than a per-line consistent shine —
it reads as broken, not as a coherent metal surface. The working technique
is `border-image` with a gradient, which only touches the border stroke and
never fights a consumer's own background utility on the same element. See
`.hex-shell`/`.hex-tile`/`.hex-chrome`/`.hex-tag`/`.hex-divider` in
`global.css` for the current implementation.

## Reference 1 — CSS-Tricks: "Responsive Hexagon Grid Using Modern CSS"
<https://css-tricks.com/responsive-hexagon-grid-using-modern-css/>

True regular-hexagon honeycomb tessellation for a grid of same-size tiles
(icon/feature tiles, not text-heavy cards).

- Modern (Chrome-only) method: `aspect-ratio: cos(30deg)`, `border-radius: 50% / 25%`,
  `corner-shape: bevel` on each tile, with `margin-bottom: calc(var(--s)/(-4*cos(30deg)))`
  to pull rows together, and a `sibling-index()`-driven formula computing
  `margin-left` on alternating rows to offset them into the honeycomb
  interlock (no media queries needed — pure CSS math against container
  width).
- Fallback (broader support) method: a flat-top hexagon via `clip-path`
  using percentages beyond 0–100% combined with `aspect-ratio: cos(30deg)`
  so the box's own proportions complete the hexagon geometry.
- Applies to: the homepage feature/capability tile grid (confirmed target —
  the existing "What the runtime includes" style row and the λ/↻/⬡ glyph
  badges, which have enough items to tessellate well).

## Reference 2 — CSS-Tricks: "Making a Responsive Pyramidal Grid with Modern CSS"
<https://css-tricks.com/making-a-responsive-pyramidal-grid-with-modern-css/>

A hexagon grid arranged as a pyramid (fewer items per row toward the apex)
rather than a uniform honeycomb.

- CSS Grid: `grid-template-columns: repeat(auto-fit, var(--s) var(--s))`,
  `justify-content: center`, each tile spans 2 columns (`grid-column-end: span 2`)
  to keep the column count even for controlled row shifting.
- Hexagon tiles use the same `aspect-ratio: cos(30deg)` + `border-radius: 50% / 25%`
  + `corner-shape: bevel` shape trick as Reference 1.
- Pyramid row-start positions come from a triangular-number formula:
  `j*(j+1)/2 + 1 = index` identifies which items start a new (shorter) row;
  `j = sqrt(2*index - 1.75) - .5` computed per item via `sibling-index()`,
  then `grid-column-start: calc(N - j)` positions each row progressively
  inward.
- Gracefully falls back from pyramid to plain honeycomb when the container
  is too narrow for the current row width (a secondary formula repositions
  rows to avoid overlap at small sizes).
- Best suited to hierarchical/one-featured-item-over-several-supporting-items
  content. Applies to: the homepage hero's AUTHOR/EXECUTE/INSPECT 3-card
  stack (confirmed target — a light, exploratory use, e.g. 1-over-2 or
  2-over-1 arrangement instead of a plain stacked column).

## Reference 3 — Metallic text CSS (user-pasted, redirected)

```css
.metallic-text {
  background: linear-gradient(110deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.65) 47%,
    rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.65) 53%, rgba(255,255,255,0) 62%),
    linear-gradient(180deg, #7E7E84 0%, #D9DCE1 18%, #FFFFFF 34%, #A9AEB6 50%,
    #62666D 58%, #A9AEB6 74%, #E7EAEE 92%, #FFFFFF 100%);
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

**Redirected**: the diagonal-sweep + banded-vertical-shine gradient
structure is right, but `background-clip: text` on real headline text
breaks across wrapped lines (see "Metallic effect placement" above). The
same two-layer gradient structure is now implemented as a `border-image`
on the hex-shape classes instead, using palette tokens
(`--dagonizer-divider`/`-text`/`-text2`/`-text3`) rather than hardcoded
grays — see `global.css`.

## Reference 4 — MetalliCSS
<https://github.com/MikaeI/metallicss>

A small JS library (`npm i metallicss`) applying metallic finishes via a
`metallicss` class + configurable CSS properties. Page content didn't
surface the actual gradient recipes/variant names on fetch — if a
JS-driven approach is wanted later (vs. the current pure-CSS
`border-image` technique), re-fetch the live demo at metallicss.com or
read the package's README directly rather than relying on this note.

## Reference 5 — Faceted gem/rank badge (user-pasted, for "Resources" buttons)

A circular "achievement badge" effect: 12 pie-slice `.facet` divs rotated
30° apart around a circle, each a solid color approximating a lit facet of
a gem, plus a diagonal `.glossy` highlight overlay (linear-gradient white
→ transparent, rotated 45°, `mix-blend`-style overlay), a radial-gradient
`.inner` sphere, and an outer `box-shadow` ring — variants named
bronze/silver/gold/platinum/diamond, each just a different facet color
palette (see the full CSS block from the user's message for exact colors
per variant, and the `text-shadow` recipe used to lift the label text off
the badge).

**Adaptation needed**: user wants this reworked from a **circular** badge
to a **hexagonal** one (6 facets, not 12 pie slices) for **"Resources"
buttons** — i.e., turn a resource/download link into a faceted hex-gem
button using this same layered-facet + glossy-sweep + inner-glow technique,
recolored to the site's steel/gem palette (steel facets by default, or a
cyan/violet gem-accent variant for emphasis) rather than the bronze/gold/
platinum literal metal names. Not yet implemented — geometry needs
reworking from 12 circular pie-slices (`clip: rect(...)` easily divides a
circle into 12ths) to 6 triangular facets radiating from a hexagon's
center, which is a different clip-path per facet, not a simple rotation of
the same slice.

## Status (update this section as work lands)

- [x] Metallic border-image on `.hex-shell`/`.hex-tile`/`.hex-chrome`/`.hex-tag`/`.hex-divider`
- [x] Two-category rule implemented: `.hex-cell` (true regular hexagon, fixed-size only) vs `.hex-shell`/`.hex-tile`/`.hex-chrome`/`.hex-tag` (plain rectangle, metallic border, variable-width content) — replaces the earlier rejected "elongated hexagon" and octagon attempts
- [x] Logo mount renders the (already-hexagonal) icon image directly, no redundant wrapper hex container
- [x] `.hex-honeycomb` + `.hex-cell` honeycomb cluster for the 3 feature glyphs (λ/↻/⬡) above the (still-rectangular) text card grid — Reference 1. Note: `UiMarketingCardGrid` itself (reused by docs guide/reference indexes with 20-27 items) stays rectangular per the two-category rule — its cards hold variable-length title/body text, not fixed-size content.
- [x] Pyramidal 1-over-2 layout (`col-span-2` on the first card) for the hero's AUTHOR/EXECUTE/INSPECT 3-card stack — Reference 2
- [x] `.hex-gem` faceted marker (conic-gradient 6-facet simulation + glossy sweep) next to each "Resources" footer link — Reference 5, adapted from circular to hexagonal; the link text itself stays a plain rectangle (variable-width), only the small fixed-size marker is the hex-gem
