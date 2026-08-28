<script setup lang="ts">
const props = defineProps<{
  title: string;
  ariaLabel: string;
  accent?: string;
  width?: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();
</script>

<template>
  <aside
    class="inspector-shell"
    role="dialog"
    :aria-label="props.ariaLabel"
    :style="{
      '--inspector-accent': props.accent ?? 'var(--dagonizer-brand)',
      '--inspector-width': props.width ?? '360px',
    }"
  >
    <header class="inspector-shell__header">
      <span class="inspector-shell__title" :title="props.title">
        <slot name="title">{{ props.title }}</slot>
      </span>
      <button class="inspector-shell__close" title="Close (Esc)" @click="emit('close')">✕</button>
    </header>

    <div class="inspector-shell__body">
      <slot />
    </div>
  </aside>
</template>

<style scoped>
.inspector-shell {
  position: absolute;
  top: 10px;
  right: 10px;
  width: var(--inspector-width);
  max-width: 88%;
  max-height: calc(100% - 20px);
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--inspector-accent);
  border-radius: 6px;
  padding: 0.75rem 0.9rem;
  box-shadow: 0 8px 32px -8px rgba(0, 0, 0, 0.45);
  z-index: 6;
  overflow-y: auto;
  animation: inspector-shell-in 0.18s ease-out;
}

.inspector-shell__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-bottom: 0.3rem;
}

.inspector-shell__title {
  color: var(--inspector-accent);
  font-weight: 700;
  font-size: 0.92rem;
  font-family: var(--vp-font-family-mono);
  overflow-wrap: anywhere;
}

.inspector-shell__close {
  background: transparent;
  border: 0;
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0 0.3rem;
  flex-shrink: 0;
}

.inspector-shell__close:hover {
  color: var(--dagonizer-brand3);
}

.inspector-shell__body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

@keyframes inspector-shell-in {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>
