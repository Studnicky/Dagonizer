<script setup lang="ts">
defineProps<{
  title: string;
}>();
</script>

<template>
  <section class="ui-readout-group">
    <header class="ui-readout-group__head">{{ title }}</header>
    <div class="ui-readout-group__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ui-readout-group {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ui-readout-group__head {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  padding: 0.2rem 0 0.1rem;
  margin-top: 0.25rem;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 0.15rem;
}

.ui-readout-group__body {
  display: flex;
  flex-direction: column;
  gap: 0;
}
</style>
