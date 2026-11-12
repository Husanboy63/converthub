<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { NAlert, NButton, NCard, NSpace, NText, useMessage } from 'naive-ui';
import { createJob, getJob } from '../api/client';
import DropZone from './DropZone.vue';
import JobProgress from './JobProgress.vue';
import ResultsList from './ResultsList.vue';
import SettingsPanel from './SettingsPanel.vue';
import type { JobSummary, ProcessOptions, SelectedFile } from '../types';

const STUCK_POLL_THRESHOLD = 20;

const message = useMessage();
const selectedFiles = ref<SelectedFile[]>([]);
const options = ref<ProcessOptions>({
  format: 'webp',
  quality: 80,
  maxWidth: null,
  maxHeight: null,
  stripMetadata: true,
});
const job = ref<JobSummary | null>(null);
const jobId = ref<string | null>(null);
const uploading = ref(false);
const jobStuck = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastProcessed = -1;
let stagnantPolls = 0;

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stagnantPolls = 0;
  lastProcessed = -1;
  jobStuck.value = false;
}

function resetJob() {
  stopPolling();
  job.value = null;
  jobId.value = null;
  jobStuck.value = false;
}

function startPolling(id: string) {
  stopPolling();

  const poll = async () => {
    try {
      const summary = await getJob(id);
      job.value = summary;

      if (summary.status === 'processing' || summary.status === 'pending') {
        if (summary.processed === lastProcessed) {
          stagnantPolls += 1;
        } else {
          stagnantPolls = 0;
          lastProcessed = summary.processed;
        }
        jobStuck.value = stagnantPolls >= STUCK_POLL_THRESHOLD;
      }

      if (summary.status === 'done' || summary.status === 'failed') {
        stopPolling();
        if (summary.status === 'done') {
          message.success('Обработка завершена');
        } else {
          message.error(summary.error ?? 'Ошибка обработки');
        }
      }
    } catch (err) {
      stopPolling();
      message.error(err instanceof Error ? err.message : 'Ошибка опроса статуса');
    }
  };

  void poll();
  pollTimer = setInterval(poll, 1500);
}

async function handleSubmit() {
  if (selectedFiles.value.length === 0) {
    message.warning('Выберите хотя бы один файл');
    return;
  }

  uploading.value = true;
  resetJob();

  try {
    const files = selectedFiles.value.map((f) => f.file);
    const result = await createJob(files, options.value);
    jobId.value = result.jobId;
    startPolling(result.jobId);
    message.info('Файлы загружены, начата обработка');
  } catch (err) {
    message.error(err instanceof Error ? err.message : 'Ошибка загрузки');
  } finally {
    uploading.value = false;
  }
}

function onFilesUpdate(files: SelectedFile[]) {
  selectedFiles.value = files;
}

onUnmounted(stopPolling);
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>Оптимизация изображений</h1>
      <NText depth="3">Конвертация и сжатие фотографий</NText>
    </header>

    <NSpace vertical size="large">
      <NCard title="Файлы">
        <DropZone
          :disabled="uploading || job?.status === 'processing' || job?.status === 'pending'"
          @update="onFilesUpdate"
        />
      </NCard>

      <NCard title="Настройки">
        <SettingsPanel v-model="options" />
      </NCard>

      <NButton
        type="primary"
        size="large"
        block
        :loading="uploading"
        :disabled="job?.status === 'processing' || job?.status === 'pending'"
        @click="handleSubmit"
      >
        Применить и обработать
      </NButton>

      <JobProgress
        :job="job"
        :loading="uploading"
        :stuck="jobStuck"
        @restart="resetJob"
      />

      <ResultsList
        v-if="job && job.files.length > 0 && jobId"
        :job-id="jobId"
        :files="job.files"
      />

      <NAlert type="info" title="Примечание">
        Файлы хранятся на сервере 2 часа, затем автоматически удаляются.
      </NAlert>
    </NSpace>
  </div>
</template>

<style scoped>
.header {
  margin-bottom: 24px;
}

.header h1 {
  margin: 0 0 4px;
  font-size: 28px;
}
</style>
