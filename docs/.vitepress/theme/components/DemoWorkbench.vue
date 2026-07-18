<script setup lang="ts">
withDefaults(defineProps<{
  leftLabel: string;
  centerLabel: string;
  rightLabel: string;
  leftHint?: string | null;
  centerHint?: string | null;
  rightHint?: string | null;
}>(), {
  leftHint: null,
  centerHint: null,
  rightHint: null,
});
</script>

<template>
  <div class="demo-workbench-container">
    <div class="demo-workbench-grid">
      <section class="demo-workbench-region demo-workbench-region--left" data-workbench-region="left">
        <header class="demo-workbench-region__header">
          <h2>{{ leftLabel }}</h2>
          <p v-if="leftHint">{{ leftHint }}</p>
        </header>
        <div class="demo-workbench-region__body"><slot name="left" /></div>
      </section>

      <section class="demo-workbench-region demo-workbench-region--center" data-workbench-region="center">
        <header class="demo-workbench-region__header">
          <h2>{{ centerLabel }}</h2>
          <p v-if="centerHint">{{ centerHint }}</p>
        </header>
        <div class="demo-workbench-region__body"><slot name="center" /></div>
      </section>

      <section class="demo-workbench-region demo-workbench-region--right" data-workbench-region="right">
        <header class="demo-workbench-region__header">
          <h2>{{ rightLabel }}</h2>
          <p v-if="rightHint">{{ rightHint }}</p>
        </header>
        <div class="demo-workbench-region__body"><slot name="right" /></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.demo-workbench-container {
  container: demo-workbench / inline-size;
  width: 100%;
}

.demo-workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  width: 100%;
}

.demo-workbench-region {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-elv);
}

.demo-workbench-region__header {
  flex: 0 0 auto;
  padding: 0.7rem 0.85rem;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.demo-workbench-region__header h2 {
  margin: 0;
  color: var(--vp-c-text-1);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  line-height: 1.3;
  text-transform: uppercase;
}

.demo-workbench-region__header p {
  margin: 0.25rem 0 0;
  color: var(--vp-c-text-3);
  font-size: 0.72rem;
  line-height: 1.4;
}

.demo-workbench-region__body {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

@container demo-workbench (min-width: 720px) {
  .demo-workbench-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr);
  }

  .demo-workbench-region--right {
    grid-column: 1 / -1;
  }
}

@container demo-workbench (min-width: 1100px) {
  .demo-workbench-grid {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.45fr) minmax(0, 0.9fr);
  }

  .demo-workbench-region--right {
    grid-column: auto;
  }
}
</style>
