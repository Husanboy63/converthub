<script setup lang="ts">
import { computed } from 'vue';
import { NAlert, NButton, NProgress, NTag, NText } from 'naive-ui';
import type { JobSummary } from '../types';

const props = defineProps<{
  job: JobSummary | null;
  loading?: boolean;
  stuck?: boolean;
}>();

const emit = defineEmits<{
  restart: [];
}>();

const percent = computed(() => {
  if (!props.job || props.job.total === 0) return 0;
  return Math.round((props.job.processed / props.job.total) * 100);
});

const statusLabel = computed(() => {
  if (!props.job) return '';
  const map: Record<string, string> = {
    pending: 'В очереди',
    processing: 'Обработка',
    done: 'Готово',
    failed: 'Ошибка',
  };
  return map[props.job.status] ?? props.job.status;
});

const statusType = computed(() => {
  if (!props.job) return 'default' as const;
  const map = {
    pending: 'info' as const,
    processing: 'warning' as const,
    done: 'success' as const,
    failed: 'error' as const,
  };
  return map[props.job.status];
});
</script>

<template>
  <div v-if="job" class="progress">
    <div class="progress-header">
      <NText strong>Статус обработки</NText>
      <NTag :type="statusType" size="small">{{ statusLabel }}</NTag>
    </div>
    <NProgress
      type="line"
      :percentage="percent"
      :processing="job.status === 'processing' || job.status === 'pending'"
      :indicator-placement="'inside'"
    />
    <NText depth="3">{{ job.processed }} / {{ job.total }} файлов</NText>
    <NText v-if="job.error" type="warning">{{ job.error }}</NText>

    <NAlert v-if="stuck" type="warning" title="Обработка занимает больше обычного">
      Можно подождать или загрузить файлы снова.
    </NAlert>
    <NButton v-if="stuck" size="small" @click="emit('restart')">Начать заново</NButton>
  </div>
  <div v-else-if="loading" class="progress">
    <NText>Отправка файлов...</NText>
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
