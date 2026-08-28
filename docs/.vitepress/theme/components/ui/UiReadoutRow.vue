<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  mono?: boolean;
}>(), {
  'mono': false,
});
</script>

<template>
  <div class="ui-readout-row">
    <span class="ui-readout-row__key">{{ label }}</span>
    <span class="ui-readout-row__value" :class="{ 'ui-readout-row__value--mono': mono }">
      <slot />
    </span>
  </div>
</template>

<style scoped>
.ui-readout-row {
  display: flex;
  gap: 0.4rem;
  align-items: baseline;
  padding: 0.1rem 0;
  font-size: 0.74rem;
  border-bottom: 1px solid transparent;
  min-width: 0;
  flex-wrap: nowrap;
}

.ui-readout-row__key {
  flex-shrink: 0;
  width: 100px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-readout-row__value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.74rem;
  color: var(--vp-c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-readout-row__value--mono {
  font-family: var(--vp-font-family-mono);
}
</style>
