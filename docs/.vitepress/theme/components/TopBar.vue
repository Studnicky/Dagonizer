<script setup lang="ts">
/**
 * TopBar: owns the left zone of the VitePress navbar.
 *
 * Renders one continuous row: [sidebar toggle][icon][wordmark]. Mounted
 * via the `nav-bar-content-before` Layout slot in theme/index.ts. The
 * default `VPNavBarTitle` is hidden in base.css so this component is
 * the single authority on the left navbar zone; VitePress keeps
 * ownership of the right zone (search, nav links, theme switch).
 *
 * Sidebar toggle controls the `dagonizer-sidebar-collapsed` class on
 * <html>; the overlay-drawer CSS in base.css slides the page-tree in
 * and out. First-paint default: open on ≥1100px viewports, closed on
 * narrow so phones don't open with the drawer covering the content.
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData, withBase } from 'vitepress';

const { frontmatter } = useData();
const collapsed = ref(true);

function isHomePage(): boolean {
  return Boolean(frontmatter.value['hero']);
}

function applyClass(v: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dagonizer-sidebar-collapsed', v);
  collapsed.value = v;
}

function toggle(): void {
  applyClass(!collapsed.value);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !collapsed.value) applyClass(true);
}

function defaultCollapsedForRoute(): boolean {
  // Home page: closed by default (the hero is the focus).
  // Content pages: open on ≥1100px viewports, closed on narrow.
  if (isHomePage()) return true;
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(min-width: 1100px)').matches;
}

onMounted(() => {
  if (typeof document === 'undefined') return;
  applyClass(defaultCollapsedForRoute());
  document.addEventListener('keydown', onKey);
});

// On client-side navigation between pages, restore the per-route default.
watch(frontmatter, () => {
  applyClass(defaultCollapsedForRoute());
});

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onKey);
  }
});
</script>

<template>
  <div class="dagonizer-topbar">
    <button
      class="dagonizer-topbar-toggle"
      type="button"
      :aria-pressed="!collapsed"
      :aria-label="collapsed ? 'Show pages menu' : 'Hide pages menu'"
      :title="collapsed ? 'Show pages menu' : 'Hide pages menu (Esc)'"
      @click="toggle"
    >
      <span class="toggle-glyph" aria-hidden="true">{{ collapsed ? '☰' : '✕' }}</span>
      <span class="toggle-label">Pages</span>
    </button>

    <a class="dagonizer-topbar-brand" :href="withBase('/')" aria-label="Dagonizer home">
      <img
        class="brand-icon"
        :src="withBase('/dagonizer-icon.svg')"
        alt=""
        width="28"
        height="28"
      />
      <span class="brand-wordmark">Dagonizer</span>
    </a>

    <div class="dagonizer-topbar-backdrop" aria-hidden="true" @click="applyClass(true)"></div>
  </div>
</template>

<style scoped>
/* Single flex row: toggle and brand sit side by side at the left
   edge of the navbar. The default VitePress flex layout pushes the
   right cluster (search, nav links, theme button) to the opposite
   end on its own; we never touch it. */
.dagonizer-topbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  height: var(--vp-nav-height, 64px);
  padding-left: max(12px, env(safe-area-inset-left));
}

.dagonizer-topbar-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.7rem;
  background: transparent;
  border: 1px solid var(--dagonizer-pewter, #6b6760);
  border-radius: 4px;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  min-height: 2.2rem;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.dagonizer-topbar-toggle:hover {
  background: rgba(184, 180, 173, 0.08);
  border-color: var(--dagonizer-silver-ui, #b8b4ad);
  color: var(--vp-c-text-1);
}

.dagonizer-topbar-toggle[aria-pressed="true"] {
  border-color: var(--dagonizer-silver-ui, #b8b4ad);
  color: var(--vp-c-text-1);
  background: rgba(56, 51, 45, 0.55);
}

.dagonizer-topbar-toggle:focus-visible {
  outline: 2px solid var(--dagonizer-brand, var(--vp-c-brand-1));
  outline-offset: 1px;
}

.toggle-glyph { font-size: 0.95rem; line-height: 1; }
.toggle-label { font-size: 0.7rem; }

.dagonizer-topbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  text-decoration: none;
  color: var(--dagonizer-silver, var(--vp-c-text-1));
  font-family: var(--vp-font-family-display);
  font-weight: 700;
  font-size: 1.05rem;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.dagonizer-topbar-brand:hover { color: var(--dagonizer-gold, var(--vp-c-brand-1)); }

.brand-icon {
  width: 28px;
  height: 28px;
  display: block;
  filter: drop-shadow(0 0 6px rgba(34, 232, 255, 0.35));
}

/* Backdrop scrim: covers the page when the drawer is open. Click
   anywhere outside the drawer to dismiss. The .dagonizer-sidebar-*
   classes on <html> drive visibility (see base.css). */
.dagonizer-topbar-backdrop {
  position: fixed;
  inset: var(--vp-nav-height, 64px) 0 0 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 29;
  backdrop-filter: blur(1px);
  transition: opacity 220ms cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0;
  pointer-events: none;
}

:global(html:not(.dagonizer-sidebar-collapsed)) .dagonizer-topbar-backdrop {
  opacity: 1;
  pointer-events: auto;
}

@media (max-width: 480px) {
  .toggle-label { display: none; }
  .brand-wordmark { display: none; }
}
</style>
