<script setup lang="ts">
defineProps<{
  open?: boolean;
}>();
</script>

<template>
  <details class="ui-disclosure-card" :open="open">
    <summary class="ui-disclosure-card__summary">
      <slot name="summary" />
    </summary>
    <div class="ui-disclosure-card__body">
      <slot />
    </div>
  </details>
</template>

<style scoped>
.ui-disclosure-card {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 0.65rem 0.85rem;
  font-size: 0.85rem;
}

.ui-disclosure-card__summary {
  cursor: pointer;
  color: var(--dagonizer-brand);
  font-weight: 700;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ui-disclosure-card__body {
  min-width: 0;
}
</style>
