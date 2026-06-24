---
"@studnicky/dagonizer": patch
---

TypeScript devDependency bumped from ^5.6.0 to ^6.0.3 across all packages
(dagonizer, dagonizer-executor-node, dagonizer-store-sqlite,
dagonizer-executor-web, examples).

Source fixes driven by TS 6.0 breaking changes:

- `docs/tsconfig.json`: removed `baseUrl: "."` (deprecated in TS 6, reported as
  TS5101; unused under `moduleResolution: Bundler` with no path aliases).
- `docs/.vitepress/shims/css.d.ts` (new): ambient module declarations for CSS
  side-effect imports. TS 6.0 enables `noUncheckedSideEffectImports` by default
  (TS2882), flagging bare `import './foo.css'` where no module type exists.
  Declarations cover local theme CSS and package CSS exports
  (`@shikijs/vitepress-twoslash/style.css`,
  `@studnicky/dagonizer/viz/explorer.css`).
