<script setup lang="ts">
/**
 * DiagramFrame: generic chrome for any diagram (cytoscape, cosmos,
 * mermaid). Provides:
 *
 *   • Title bar with the diagram's name + a node/edge/triple counter
 *     (via the `meta` slot; the caller decides what to surface).
 *   • Fullscreen toggle: uses the browser Fullscreen API on the frame
 *     root so the diagram fills the whole viewport.
 *   • Expand-to-modal: covers the page with a high-z-index overlay
 *     even when fullscreen is blocked (some browsers gate FS to user
 *     gesture trees only).
 *   • Slot `controls`: diagram-specific buttons (zoom in/out/fit/etc).
 *
 * The frame doesn't know what's inside the slot; the diagram is
 * responsible for resizing itself when the frame size changes (cytoscape
 * and cosmos both expose a `resize()` call; wire them via the
 * `@resize` event we emit on every frame-size change).
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ModalController } from '../../../../packages/dagonizer/src/viz/ModalController.ts';
import { viewerAction } from '../../../../packages/dagonizer/src/viz/ViewerActions.ts';
import type { ViewerActionIdType } from '../../../../packages/dagonizer/src/viz/ViewerActions.ts';
import ViewerActions from './graph/ViewerActions.vue';
import PanelHeader from './ui/PanelHeader.vue';

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
const frameActions = computed(() => [
  viewerAction('expand', {
    'label': expanded.value ? '⤡' : '⤢',
    'title': expanded.value ? 'Collapse' : 'Expand',
    'pressed': expanded.value,
  }),
  viewerAction('fullscreen', {
    'title': isFullscreen.value ? 'Exit fullscreen' : 'Fullscreen',
    'pressed': isFullscreen.value,
  }),
]);

let resizeObserver: ResizeObserver | null = null;
const modalController = new ModalController({
  'onStateChange': (open) => {
    expanded.value = open;
    requestAnimationFrame(() => emit('resize'));
  },
});

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && frameRef.value !== null) {
    resizeObserver = new ResizeObserver(() => emit('resize'));
    resizeObserver.observe(frameRef.value);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('keydown', onDocumentKey);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('keydown', onDocumentKey);
  }
});

function onFsChange(): void {
  const fs = document.fullscreenElement === frameRef.value;
  if (fs !== isFullscreen.value) {
    isFullscreen.value = fs;
    emit('fullscreen-change', fs);
    // Give the fullscreen transition a frame to settle before signalling
    // the diagram to resize/fit; without this delay cytoscape measures a
    // stale container size and renders a blank canvas.
    requestAnimationFrame(() => emit('resize'));
  }
}

async function toggleFullscreen(): Promise<void> {
  if (frameRef.value === null) return;
  // If already in CSS-expanded mode, toggle it off.
  if (expanded.value) {
    toggleExpand();
    return;
  }
  if (document.fullscreenElement === frameRef.value) {
    await document.exitFullscreen();
    return;
  }
  try {
    await frameRef.value.requestFullscreen();
  } catch {
    // Fullscreen blocked (some browsers require a specific gesture path);
    // fall back to CSS expand so the mounted slot content stays visible.
    toggleExpand();
  }
}

function toggleExpand(): void {
  modalController.toggle();
}

function onModalKey(event: KeyboardEvent): void {
  modalController.onKeyDown(event.key);
}

function onDocumentKey(event: KeyboardEvent): void {
  modalController.onKeyDown(event.key);
}

function onFrameAction(id: ViewerActionIdType): void {
  if (id === 'expand') {
    toggleExpand();
    return;
  }
  if (id === 'fullscreen') {
    void toggleFullscreen();
  }
}

// Exposed so a hosting diagram (e.g. the DagGraph D-pad's expand button) can
// drive fullscreen / expand without the frame's own header controls.
defineExpose({ toggleFullscreen, toggleExpand });
</script>

<template>
  <div
    ref="frameRef"
    :class="['diagram-frame', { 'is-fullscreen': isFullscreen, 'is-expanded dagonizer-modal-card': expanded }]"
    :aria-label="ariaLabel ?? title"
    :tabindex="expanded ? 0 : undefined"
    @keydown="onModalKey"
  >
    <PanelHeader
      v-if="!frameless"
      class="frame-header"
      :title="title"
      variant="band"
    >
      <template #meta>
        <slot name="meta" />
      </template>
      <template #actions>
        <slot name="controls" />
        <ViewerActions
          :actions="frameActions"
          @action="onFrameAction"
        />
      </template>
    </PanelHeader>

    <div class="frame-body">
      <slot />
    </div>
  </div>

  <!-- Backdrop: closes the expand when clicked outside the card -->
  <Teleport to="body">
    <div
      v-if="expanded && !isFullscreen"
      class="frame-overlay-backdrop dagonizer-modal-backdrop"
      aria-hidden="true"
      @click="toggleExpand"
    />
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
  position: fixed;
  inset: 2rem;
  z-index: 9999;
  border-radius: var(--dagonizer-modal-radius, 8px);
  border-color: var(--dagonizer-modal-border, var(--dagonizer-brand));
  box-shadow: var(--dagonizer-modal-shadow, 0 10px 50px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--dagonizer-brand));
  background: var(--dagonizer-modal-surface, var(--vp-c-bg-elv));
  animation: dagonizer-modal-in 0.18s ease-out;
}

.frame-header {
  :deep(.dg-panel-header__meta) {
    font-size: 0.7rem;
    color: var(--vp-c-text-2);
  }
}

.frame-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

/* Semi-transparent backdrop behind the expanded frame card. */
.frame-overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: var(--dagonizer-modal-backdrop, rgba(0, 0, 0, 0.78));
  backdrop-filter: blur(var(--dagonizer-modal-blur, 6px));
  animation: dagonizer-modal-in 0.18s ease-out;
}
</style>
