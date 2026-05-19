<script setup lang="ts">
/**
 * DiagramFrame — generic chrome for any diagram (cytoscape, cosmos,
 * mermaid). Provides:
 *
 *   • Title bar with the diagram's name + a node/edge/triple counter
 *     (via the `meta` slot — the caller decides what to surface).
 *   • Fullscreen toggle — uses the browser Fullscreen API on the frame
 *     root so the diagram fills the whole viewport.
 *   • Expand-to-modal — covers the page with a high-z-index overlay
 *     even when fullscreen is blocked (some browsers gate FS to user
 *     gesture trees only).
 *   • Slot `controls` — diagram-specific buttons (zoom in/out/fit/etc).
 *
 * The frame doesn't know what's inside the slot; the diagram is
 * responsible for resizing itself when the frame size changes (cytoscape
 * and cosmos both expose a `resize()` call — wire them via the
 * `@resize` event we emit on every frame-size change).
 */

import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps<{
  title: string;
  ariaLabel?: string;
  /** When true, the title bar is hidden. Use when the hosting tabs already serve as the title. */
  frameless?: boolean;
}>();

const emit = defineEmits<{
  (event: 'resize'): void;
  (event: 'fullscreen-change', value: boolean): void;
}>();

const frameRef = ref<HTMLDivElement | null>(null);
const expanded = ref(false);
const isFullscreen = ref(false);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && frameRef.value !== null) {
    resizeObserver = new ResizeObserver(() => emit('resize'));
    resizeObserver.observe(frameRef.value);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', onFsChange);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', onFsChange);
  }
});

function onFsChange(): void {
  const fs = document.fullscreenElement === frameRef.value;
  if (fs !== isFullscreen.value) {
    isFullscreen.value = fs;
    emit('fullscreen-change', fs);
  }
}

async function toggleFullscreen(): Promise<void> {
  if (frameRef.value === null) return;
  if (document.fullscreenElement === frameRef.value) {
    await document.exitFullscreen();
    return;
  }
  try {
    await frameRef.value.requestFullscreen();
  } catch {
    // Fullscreen blocked (some browsers require a specific gesture path);
    // fall back to the expanded modal.
    expanded.value = true;
  }
}

function toggleExpand(): void {
  expanded.value = !expanded.value;
  // Give the layout a tick to settle, then signal slot to resize.
  requestAnimationFrame(() => emit('resize'));
}

function onModalKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') expanded.value = false;
}
</script>

<template>
  <div
    ref="frameRef"
    :class="['diagram-frame', { 'is-fullscreen': isFullscreen, 'is-expanded': expanded }]"
    :aria-label="ariaLabel ?? title"
  >
    <header v-if="!frameless" class="frame-header">
      <h4 class="frame-title">{{ title }}</h4>
      <div class="frame-meta">
        <slot name="meta" />
      </div>
      <div class="frame-actions">
        <slot name="controls" />
        <button
          class="frame-action"
          :title="expanded ? 'Collapse' : 'Expand'"
          :aria-pressed="expanded"
          @click="toggleExpand"
        >{{ expanded ? '⤡' : '⤢' }}</button>
        <button
          class="frame-action"
          :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          :aria-pressed="isFullscreen"
          @click="toggleFullscreen"
        >{{ isFullscreen ? '⛶' : '⛶' }}</button>
      </div>
    </header>

    <div class="frame-body">
      <slot />
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="expanded && !isFullscreen"
      class="frame-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="`${title} (expanded)`"
      tabindex="-1"
      @keydown="onModalKey"
      @click.self="expanded = false"
    >
      <div class="frame-overlay-card">
        <header class="frame-overlay-header">
          <h4 class="frame-title">{{ title }} — expanded</h4>
          <button class="frame-action" title="Close" @click="expanded = false">✕</button>
        </header>
        <div class="frame-overlay-body">
          <slot name="overlay" />
          <p class="frame-overlay-hint">Press Esc to close.</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.diagram-frame {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  overflow: hidden;
  transition: box-shadow 0.18s ease, border-color 0.18s ease;
}

.diagram-frame:hover {
  border-color: var(--dagonizer-brand);
}

.diagram-frame.is-fullscreen {
  border: 0;
  border-radius: 0;
  background: var(--vp-c-bg);
}

.diagram-frame.is-expanded {
  /* The expanded card replaces the inline frame — keep the slot mounted. */
}

.frame-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.7rem;
  background: var(--vp-c-bg-alt);
  border-bottom: 1px solid var(--vp-c-divider);
}

.frame-title {
  margin: 0;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--vp-c-text-3);
}

.frame-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  color: var(--vp-c-text-2);
}

.frame-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-items: center;
}

.frame-action {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.frame-action:hover {
  background: var(--vp-c-bg);
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.frame-action:focus-visible {
  outline: 2px solid var(--dagonizer-brand);
  outline-offset: 1px;
}

.frame-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

/* Expand modal — covers viewport when fullscreen is blocked. */
.frame-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 2rem;
  animation: overlay-in 0.18s ease-out;
}

.frame-overlay-card {
  width: 100%;
  height: 100%;
  max-width: 1600px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg);
  border: 1px solid var(--dagonizer-brand);
  border-radius: 8px;
  box-shadow: 0 10px 50px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--dagonizer-brand);
  overflow: hidden;
}

.frame-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.85rem;
  background: var(--vp-c-bg-alt);
  border-bottom: 1px solid var(--vp-c-divider);
}

.frame-overlay-body {
  flex: 1 1 auto;
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.frame-overlay-hint {
  position: absolute;
  bottom: 8px;
  right: 12px;
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 0.65rem;
  color: var(--vp-c-text-3);
  pointer-events: none;
}

@keyframes overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
</style>
