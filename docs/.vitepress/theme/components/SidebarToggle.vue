<script setup lang="ts">
/**
 * SidebarToggle — page-tree drawer toggle.
 *
 * Mirrors iridis's NavBarSidebarToggle pattern: adds/removes
 * `.dagonizer-sidebar-collapsed` on <html>; the CSS in base.css
 * translates the drawer in/out. Default state on first paint is
 * uncollapsed on wide viewports (≥1100px), collapsed on narrow so
 * phones don't open with the drawer covering the page.
 *
 * Also teleports a backdrop scrim into <body> — clicked to dismiss
 * the open drawer at any width. The backdrop is invisible on wide
 * viewports (CSS keeps `opacity: 0`) but still catches the dismiss
 * click on small ones.
 *
 * Keyboard: `Esc` closes when the drawer is open.
 */

import { onBeforeUnmount, onMounted, ref } from 'vue';

const collapsed = ref(true);
const mounted = ref(false);
let mql: MediaQueryList | null = null;

function syncFromDom(): void {
  if (typeof document === 'undefined') return;
  collapsed.value = document.documentElement.classList.contains('dagonizer-sidebar-collapsed');
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !collapsed.value) close();
}

function applyClass(v: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dagonizer-sidebar-collapsed', v);
  collapsed.value = v;
}

function toggle(): void { applyClass(!collapsed.value); }
function close():  void { applyClass(true); }

onMounted(() => {
  if (typeof document === 'undefined') return;
  // Default: open on wide screens, closed on narrow.
  mql = window.matchMedia('(min-width: 1100px)');
  applyClass(!mql.matches);
  document.addEventListener('keydown', onKey);
  mounted.value = true;
});

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onKey);
  }
  mql = null;
});

void syncFromDom;
</script>

<template>
  <button
    class="dagonizer-sidebar-toggle"
    type="button"
    :aria-pressed="!collapsed"
    :aria-label="collapsed ? 'Show pages menu' : 'Hide pages menu'"
    :title="collapsed ? 'Show pages menu (P)' : 'Hide pages menu (Esc)'"
    @click="toggle"
  >
    <span class="toggle-icon" aria-hidden="true">{{ collapsed ? '☰' : '✕' }}</span>
    <span class="toggle-label">Pages</span>
  </button>

  <Teleport v-if="mounted" to="body">
    <div
      class="dagonizer-sidebar-backdrop"
      aria-hidden="true"
      @click="close"
    ></div>
  </Teleport>
</template>

<style scoped>
.dagonizer-sidebar-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.7rem;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  min-height: 2.2rem;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.dagonizer-sidebar-toggle:hover {
  background: var(--vp-c-bg);
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.dagonizer-sidebar-toggle[aria-pressed="true"] {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
  background: color-mix(in oklch, var(--dagonizer-brand) 12%, var(--vp-c-bg-elv));
}

.dagonizer-sidebar-toggle:focus-visible {
  outline: 2px solid var(--dagonizer-brand);
  outline-offset: 1px;
}

.toggle-icon {
  font-size: 0.95rem;
  line-height: 1;
}

.toggle-label {
  font-size: 0.7rem;
}

@media (max-width: 480px) {
  .toggle-label { display: none; }
}
</style>
