<script setup lang="ts">
import { computed } from 'vue';
import BackendPicker from './BackendPicker.vue';
import { LlmBackendStatus } from './LlmBackendStatus';

import type { BackendAvailability, ProviderId } from '../../../../examples/the-archivist/providers/index.ts';

const props = defineProps<{
  backends: readonly BackendAvailability[];
  activeId: ProviderId | null;
  apiKeys: Partial<Record<ProviderId, string>>;
  preferredModels: Partial<Record<ProviderId, string>>;
  isMobile?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:activeId', value: ProviderId): void;
  (event: 'update:apiKeys', value: Partial<Record<ProviderId, string>>): void;
  (event: 'update:preferredModels', value: Partial<Record<ProviderId, string>>): void;
}>();

const warning = computed(() => LlmBackendStatus.warning(props.activeId));
</script>

<template>
  <div class="llm-configuration-pane">
    <div v-if="warning !== null" class="llm-configuration-pane__warning" role="alert">
      {{ warning }}
    </div>

    <section class="llm-configuration-pane__section" aria-labelledby="llm-backend-heading">
      <h2 id="llm-backend-heading">Backend</h2>
      <BackendPicker
        :backends="backends"
        :active-id="activeId"
        :api-keys="apiKeys"
        :preferred-models="preferredModels"
        :is-mobile="isMobile"
        :disabled="disabled"
        @update:active-id="emit('update:activeId', $event)"
        @update:api-keys="emit('update:apiKeys', $event)"
        @update:preferred-models="emit('update:preferredModels', $event)"
      />
    </section>
  </div>
</template>

<style scoped>
.llm-configuration-pane {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1.1rem;
}

.llm-configuration-pane__warning {
  padding: 0.6rem 0.8rem;
  border: 1px solid #d4a649;
  border-radius: 6px;
  background: rgba(212, 166, 73, 0.1);
  color: var(--vp-c-text-1);
  font-size: 0.82rem;
  line-height: 1.4;
}

.llm-configuration-pane__section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.55rem;
}

.llm-configuration-pane__section h2 {
  margin: 0;
  color: var(--vp-c-text-3);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
</style>
