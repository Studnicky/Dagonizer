<script setup lang="ts">
const props = withDefaults(defineProps<{
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
}>(), {
  'type': 'button',
  'variant': 'secondary',
  'size': 'md',
  'loading': false,
  'disabled': false,
  'block': false,
});
</script>

<template>
  <button
    :type="props.type"
    :disabled="props.disabled || props.loading"
    :class="[
      'ui-button',
      `ui-button--${props.variant}`,
      `ui-button--${props.size}`,
      props.block ? 'ui-button--block' : '',
      props.loading ? 'ui-button--loading' : '',
    ]"
  >
    <span v-if="$slots.leading" class="ui-button__leading"><slot name="leading" /></span>
    <span v-if="$slots.default" class="ui-button__label"><slot /></span>
    <span v-if="$slots.trailing" class="ui-button__trailing"><slot name="trailing" /></span>
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border-radius: 6px;
  border: 1px solid var(--ui-button-border, var(--vp-c-divider));
  background: var(--ui-button-fill, transparent);
  color: var(--ui-button-text, var(--vp-c-text-1));
  font-weight: 600;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease, filter 0.14s ease, transform 0.14s ease;
}

.ui-button--sm { padding: 0.35rem 0.7rem; font-size: 0.78rem; }
.ui-button--md { padding: 0.48rem 0.95rem; font-size: 0.85rem; }
.ui-button--icon { width: 40px; height: 40px; padding: 0; font-size: 1rem; }
.ui-button--block { width: 100%; }

.ui-button--primary {
  --ui-button-fill: var(--dagonizer-brand);
  --ui-button-border: var(--dagonizer-brand);
  --ui-button-text: var(--vp-c-bg-elv);
}

.ui-button--secondary {
  --ui-button-fill: transparent;
  --ui-button-border: var(--vp-c-divider);
  --ui-button-text: var(--vp-c-text-1);
}

.ui-button--ghost {
  --ui-button-fill: transparent;
  --ui-button-border: transparent;
  --ui-button-text: var(--vp-c-text-3);
}

.ui-button--danger {
  --ui-button-fill: #c0392b;
  --ui-button-border: #c0392b;
  --ui-button-text: #fff7f6;
}

.ui-button:hover:not(:disabled) {
  filter: brightness(1.08);
}

.ui-button--secondary:hover:not(:disabled),
.ui-button--ghost:hover:not(:disabled) {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.ui-button--ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dagonizer-brand) 10%, transparent);
}

.ui-button:focus-visible {
  outline: 2px solid var(--dagonizer-brand);
  outline-offset: 2px;
}

.ui-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-button__leading,
.ui-button__trailing,
.ui-button__label {
  display: inline-flex;
  align-items: center;
}
</style>
