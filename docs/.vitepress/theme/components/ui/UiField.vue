<script setup lang="ts">
withDefaults(defineProps<{
  label?: string;
  hint?: string | null;
  help?: string | null;
  error?: string | null;
  forId?: string;
  unit?: string | null;
}>(), {
  'hint': null,
  'help': null,
  'error': null,
  'unit': null,
});
</script>

<template>
  <div class="ui-field">
    <div v-if="label || hint || $slots.header" class="ui-field__header">
      <slot name="header">
        <label v-if="label" class="ui-field__label" :for="forId">{{ label }}</label>
        <span v-if="hint" class="ui-field__hint">{{ hint }}</span>
      </slot>
    </div>
    <div class="ui-field__body">
      <slot />
      <span v-if="unit" class="ui-field__unit">{{ unit }}</span>
    </div>
    <div v-if="help || error || $slots.footer" class="ui-field__footer">
      <slot name="footer">
        <span v-if="help" class="ui-field__help">{{ help }}</span>
        <span v-if="error" class="ui-field__error" role="alert">{{ error }}</span>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.ui-field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.ui-field__header,
.ui-field__body,
.ui-field__footer {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.ui-field__label,
.ui-field__unit,
.ui-field__hint,
.ui-field__footer,
.ui-field__help,
.ui-field__error {
  font-family: var(--vp-font-family-mono);
}

.ui-field__label {
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.ui-field__hint,
.ui-field__footer {
  font-size: 0.68rem;
  color: var(--vp-c-text-3);
}

.ui-field__hint { font-style: italic; }
.ui-field__unit { font-size: 0.72rem; color: var(--vp-c-text-3); }
.ui-field__help { color: var(--vp-c-text-3); }
.ui-field__error { color: #d96b5f; }
</style>
