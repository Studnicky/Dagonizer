<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <label v-if="$attrs['data-as'] !== 'div'" class="ui-form-row">
    <span class="ui-form-row__label">{{ label }}</span>
    <span class="ui-form-row__control">
      <slot />
    </span>
  </label>
  <div v-else class="ui-form-row">
    <span class="ui-form-row__label">{{ label }}</span>
    <span class="ui-form-row__control">
      <slot />
    </span>
  </div>
</template>

<style scoped>
.ui-form-row {
  display: grid;
  grid-template-columns: minmax(7rem, auto) 1fr;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.ui-form-row__label {
  color: var(--vp-c-text-3);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.ui-form-row__control {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.ui-form-row__control > :deep(*) {
  min-width: 0;
}
</style>
