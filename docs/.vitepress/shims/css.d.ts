/**
 * Ambient type declarations for CSS side-effect imports in the VitePress docs
 * theme.
 *
 * TypeScript 6.0 introduces `noUncheckedSideEffectImports` (default: true),
 * which flags bare `import './foo.css'` statements when the imported specifier
 * cannot be resolved as a known module. Vite handles CSS imports at bundle
 * time, so no runtime module exists — these declarations satisfy the type
 * checker without disabling any strictness flags.
 *
 * Covers:
 *   - Local theme CSS files (`./palette.css`, `./base.css`).
 *   - Package CSS exports that ship no type declarations:
 *       `@shikijs/vitepress-twoslash/style.css`
 *       `@studnicky/dagonizer/viz/explorer.css`
 */

declare module '*.css' {}

declare module '@shikijs/vitepress-twoslash/style.css' {}

declare module '@studnicky/dagonizer/viz/explorer.css' {}
